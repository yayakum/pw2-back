const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'tu_clave_secreta'; // Debe ser la misma que en app.js

const startSocketServer = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: "*", // Configura según tus necesidades
      methods: ["GET", "POST"]
    }
  });

  // Almacena los usuarios conectados: { userId: socketId }
  const connectedUsers = {};

  // Middleware para autenticar usuarios
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Autenticación requerida'));
      }

      // Verificar token
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await prisma.usuario.findUnique({
        where: { id: decoded.userId }
      });

      if (!user) {
        return next(new Error('Usuario no encontrado'));
      }

      // Adjuntar usuario al socket
      socket.user = user;
      next();
    } catch (error) {
      return next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    
    // Registrar usuario conectado
    connectedUsers[userId] = socket.id;
    console.log(`Usuario conectado: ${userId}, Socket ID: ${socket.id}`);
    
    // Informar estado en línea
    io.emit('user_status', { userId, online: true });

    // Enviar mensaje
    socket.on('send_message', async (data) => {
      try {
        const { receiverId, content } = data;
        
        if (!content || content.trim() === '') {
          socket.emit('error', { message: 'El contenido del mensaje es requerido' });
          return;
        }
        
        // Verificar si el usuario receptor existe
        const receiverExists = await prisma.usuario.findUnique({
          where: { id: parseInt(receiverId) }
        });
        
        if (!receiverExists) {
          socket.emit('error', { message: 'Usuario receptor no encontrado' });
          return;
        }
        
        if (parseInt(receiverId) === userId) {
          socket.emit('error', { message: 'No puedes enviarte mensajes a ti mismo' });
          return;
        }
        
        // Guardar mensaje en la base de datos
        const newMessage = await prisma.message.create({
          data: {
            content,
            senderId: userId,
            receiverId: parseInt(receiverId)
          },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                profilePic: true
              }
            },
            receiver: {
              select: {
                id: true,
                username: true,
                profilePic: true
              }
            }
          }
        });
        
        // Formatear respuesta
        const formattedMessage = {
          ...newMessage,
          sender: {
            ...newMessage.sender,
            profilePic: newMessage.sender.profilePic ? newMessage.sender.profilePic.toString('base64') : null
          },
          receiver: {
            ...newMessage.receiver,
            profilePic: newMessage.receiver.profilePic ? newMessage.receiver.profilePic.toString('base64') : null
          }
        };
        
        // Enviar mensaje al remitente
        socket.emit('receive_message', formattedMessage);
        
        // Enviar mensaje al destinatario si está conectado
        if (connectedUsers[receiverId]) {
          io.to(connectedUsers[receiverId]).emit('receive_message', formattedMessage);
        }
      } catch (error) {
        console.error('Error al enviar mensaje:', error);
        socket.emit('error', { message: 'Error al enviar mensaje', details: error.message });
      }
    });

    // Marcar mensajes como leídos
    socket.on('mark_messages_read', async (data) => {
      try {
        const { senderId } = data;
        
        await prisma.message.updateMany({
          where: {
            senderId: parseInt(senderId),
            receiverId: userId,
            isRead: false
          },
          data: {
            isRead: true
          }
        });
        
        // Notificar al remitente que sus mensajes fueron leídos
        if (connectedUsers[senderId]) {
          io.to(connectedUsers[senderId]).emit('messages_read', { byUserId: userId });
        }
        
        socket.emit('messages_marked_read', { senderId });
      } catch (error) {
        console.error('Error al marcar mensajes como leídos:', error);
        socket.emit('error', { message: 'Error al marcar mensajes como leídos', details: error.message });
      }
    });

    // Editar mensaje
    socket.on('edit_message', async (data) => {
      try {
        const { messageId, content } = data;
        
        if (!content || content.trim() === '') {
          socket.emit('error', { message: 'El contenido del mensaje es requerido' });
          return;
        }
        
        // Verificar si el mensaje existe y pertenece al usuario
        const message = await prisma.message.findUnique({
          where: { id: parseInt(messageId) },
          include: { receiver: true }
        });
        
        if (!message) {
          socket.emit('error', { message: 'Mensaje no encontrado' });
          return;
        }
        
        if (message.senderId !== userId) {
          socket.emit('error', { message: 'No tienes permiso para editar este mensaje' });
          return;
        }
        
        // Actualizar mensaje
        const updatedMessage = await prisma.message.update({
          where: { id: parseInt(messageId) },
          data: { content },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                profilePic: true
              }
            },
            receiver: {
              select: {
                id: true,
                username: true,
                profilePic: true
              }
            }
          }
        });
        
        // Formatear respuesta
        const formattedMessage = {
          ...updatedMessage,
          sender: {
            ...updatedMessage.sender,
            profilePic: updatedMessage.sender.profilePic ? updatedMessage.sender.profilePic.toString('base64') : null
          },
          receiver: {
            ...updatedMessage.receiver,
            profilePic: updatedMessage.receiver.profilePic ? updatedMessage.receiver.profilePic.toString('base64') : null
          }
        };
        
        // Notificar al remitente
        socket.emit('message_updated', formattedMessage);
        
        // Notificar al destinatario si está conectado
        const receiverId = message.receiverId;
        if (connectedUsers[receiverId]) {
          io.to(connectedUsers[receiverId]).emit('message_updated', formattedMessage);
        }
      } catch (error) {
        console.error('Error al editar mensaje:', error);
        socket.emit('error', { message: 'Error al editar mensaje', details: error.message });
      }
    });

    // Eliminar mensaje
    socket.on('delete_message', async (data) => {
      try {
        const { messageId } = data;
        
        // Verificar si el mensaje existe y pertenece al usuario
        const message = await prisma.message.findUnique({
          where: { id: parseInt(messageId) }
        });
        
        if (!message) {
          socket.emit('error', { message: 'Mensaje no encontrado' });
          return;
        }
        
        if (message.senderId !== userId) {
          socket.emit('error', { message: 'No tienes permiso para eliminar este mensaje' });
          return;
        }
        
        // Guardar el receiverId antes de eliminar
        const receiverId = message.receiverId;
        
        // Eliminar mensaje
        await prisma.message.delete({
          where: { id: parseInt(messageId) }
        });
        
        // Notificar al remitente
        socket.emit('message_deleted', { messageId });
        
        // Notificar al destinatario si está conectado
        if (connectedUsers[receiverId]) {
          io.to(connectedUsers[receiverId]).emit('message_deleted', { messageId });
        }
      } catch (error) {
        console.error('Error al eliminar mensaje:', error);
        socket.emit('error', { message: 'Error al eliminar mensaje', details: error.message });
      }
    });

    // Desconexión
    socket.on('disconnect', () => {
      console.log(`Usuario desconectado: ${userId}`);
      delete connectedUsers[userId];
      io.emit('user_status', { userId, online: false });
    });
  });

  return io;
};

module.exports = { startSocketServer };