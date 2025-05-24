// socketManager.js - Gestor centralizado para Socket.IO
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'tu_clave_secreta'; // Debe ser la misma que en app.js

class SocketManager {
    constructor() {
        this.io = null;
        this.connectedUsers = {}; // { userId: socketId }
    }

    initialize(httpServer) {
        this.io = new Server(httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        this.setupMiddleware();
        this.setupEventHandlers();

        return this.io;
    }

    setupMiddleware() {
        // Middleware para autenticar usuarios
        this.io.use(async (socket, next) => {
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
    }

    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            const userId = socket.user.id;
            
            // Registrar usuario conectado
            this.connectedUsers[userId] = socket.id;
            console.log(`Usuario conectado: ${userId}, Socket ID: ${socket.id}`);
            
            // Informar estado en línea
            this.io.emit('user_status', { userId, online: true });

            // Manejar eventos de mensajes
            this.handleMessageEvents(socket);

            // Desconexión
            socket.on('disconnect', () => {
                console.log(`Usuario desconectado: ${userId}`);
                delete this.connectedUsers[userId];
                this.io.emit('user_status', { userId, online: false });
            });
        });
    }

    handleMessageEvents(socket) {
        const userId = socket.user.id;

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

                // Crear notificación para el receptor usando el método centralizado
                this.createNotification({
                    type: 'message',
                    userId: parseInt(receiverId),
                    fromUserId: userId,
                    fromUsername: socket.user.username
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
                if (this.connectedUsers[receiverId]) {
                    this.io.to(this.connectedUsers[receiverId]).emit('receive_message', formattedMessage);
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
                if (this.connectedUsers[senderId]) {
                    this.io.to(this.connectedUsers[senderId]).emit('messages_read', { byUserId: userId });
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
                if (this.connectedUsers[receiverId]) {
                    this.io.to(this.connectedUsers[receiverId]).emit('message_updated', formattedMessage);
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
                if (this.connectedUsers[receiverId]) {
                    this.io.to(this.connectedUsers[receiverId]).emit('message_deleted', { messageId });
                }
            } catch (error) {
                console.error('Error al eliminar mensaje:', error);
                socket.emit('error', { message: 'Error al eliminar mensaje', details: error.message });
            }
        });
    }

    // Método centralizado para crear y emitir notificaciones
    async createNotification({ type, userId, fromUserId, postId = null, fromUsername = null }) {
        try {
            // Crear notificación en la base de datos
            await prisma.notification.create({
                data: {
                    type,
                    userId,
                    fromUserId,
                    postId,
                    isRead: false
                }
            });

            // Obtener información del usuario que genera la notificación si no se proporciona
            if (!fromUsername && fromUserId) {
                const fromUser = await prisma.usuario.findUnique({
                    where: { id: fromUserId },
                    select: { username: true }
                });
                fromUsername = fromUser?.username || 'Usuario';
            }

            // Generar mensaje según el tipo
            const messages = {
                'like': `A ${fromUsername} le gustó tu publicación`,
                'comment': `${fromUsername} comentó en tu publicación`,
                'follow': `${fromUsername} comenzó a seguirte`,
                'new_post': `${fromUsername} hizo una nueva publicación`,
                'message': `${fromUsername} te envió un mensaje`
            };

            // Emitir evento de nueva notificación al usuario si está conectado
            if (this.connectedUsers[userId]) {
                this.io.to(this.connectedUsers[userId]).emit('new_notification', {
                    type,
                    fromUserId,
                    fromUsername,
                    postId,
                    message: messages[type] || `Nueva notificación de ${fromUsername}`
                });
            }

            console.log(`Notificación ${type} enviada a usuario ${userId} de ${fromUsername}`);
        } catch (error) {
            console.error('Error al crear notificación:', error);
        }
    }

    // Método para emitir notificaciones a múltiples usuarios (para new_post)
    async createBulkNotifications({ type, userIds, fromUserId, postId = null, fromUsername = null }) {
        try {
            if (userIds.length === 0) return;

            // Crear notificaciones en la base de datos
            await prisma.notification.createMany({
                data: userIds.map(userId => ({
                    type,
                    userId,
                    fromUserId,
                    postId,
                    isRead: false
                }))
            });

            // Obtener información del usuario si no se proporciona
            if (!fromUsername && fromUserId) {
                const fromUser = await prisma.usuario.findUnique({
                    where: { id: fromUserId },
                    select: { username: true }
                });
                fromUsername = fromUser?.username || 'Usuario';
            }

            // Generar mensaje
            const messages = {
                'new_post': `${fromUsername} hizo una nueva publicación`
            };

            // Emitir notificación a cada usuario conectado
            userIds.forEach(userId => {
                if (this.connectedUsers[userId]) {
                    this.io.to(this.connectedUsers[userId]).emit('new_notification', {
                        type,
                        fromUserId,
                        fromUsername,
                        postId,
                        message: messages[type] || `Nueva notificación de ${fromUsername}`
                    });
                }
            });

            console.log(`${userIds.length} notificaciones ${type} enviadas de ${fromUsername}`);
        } catch (error) {
            console.error('Error al crear notificaciones masivas:', error);
        }
    }

    // Getter para acceder al socket manager desde los controladores
    getIO() {
        return this.io;
    }

    getConnectedUsers() {
        return this.connectedUsers;
    }
}

// Exportar una instancia singleton
const socketManager = new SocketManager();

module.exports = { socketManager };