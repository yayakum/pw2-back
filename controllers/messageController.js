const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Enviar un mensaje a otro usuario
const sendMessage = async (req, res) => {
    try {
        const { receiverId, content } = req.body;
        
        if (!content || content.trim() === '') {
            return res.status(400).json({ error: 'El contenido del mensaje es requerido' });
        }
        
        // Verificar si el usuario receptor existe
        const receiverExists = await prisma.usuario.findUnique({
            where: { id: parseInt(receiverId) }
        });
        
        if (!receiverExists) {
            return res.status(404).json({ error: 'Usuario receptor no encontrado' });
        }
        
        // No permitir enviar mensajes a uno mismo
        if (parseInt(receiverId) === req.user.id) {
            return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo' });
        }
        
        const newMessage = await prisma.message.create({
            data: {
                content,
                senderId: req.user.id,
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
        
        res.status(201).json(formattedMessage);
    } catch (error) {
        res.status(500).json({ error: 'Error al enviar mensaje', details: error.message });
    }
};

// Obtener conversaciones del usuario
const getUserConversations = async (req, res) => {
    try {
        // Encontrar todos los usuarios con los que el usuario actual ha intercambiado mensajes
        const conversations = await prisma.$queryRaw`
            SELECT DISTINCT 
                u.id, 
                u.username, 
                u.profilePic,
                (
                    SELECT content 
                    FROM Message 
                    WHERE (senderId = ${req.user.id} AND receiverId = u.id) 
                    OR (senderId = u.id AND receiverId = ${req.user.id})
                    ORDER BY createdAt DESC 
                    LIMIT 1
                ) as lastMessage,
                (
                    SELECT createdAt 
                    FROM Message 
                    WHERE (senderId = ${req.user.id} AND receiverId = u.id) 
                    OR (senderId = u.id AND receiverId = ${req.user.id})
                    ORDER BY createdAt DESC 
                    LIMIT 1
                ) as lastMessageTime,
                (
                    SELECT COUNT(*) 
                    FROM Message 
                    WHERE receiverId = ${req.user.id} 
                    AND senderId = u.id 
                    AND isRead = false
                ) as unreadCount
            FROM Usuario u
            WHERE u.id IN (
                SELECT DISTINCT senderId FROM Message WHERE receiverId = ${req.user.id}
                UNION
                SELECT DISTINCT receiverId FROM Message WHERE senderId = ${req.user.id}
            )
            AND u.id != ${req.user.id}
            ORDER BY lastMessageTime DESC
        `;
        
        // Formatear las imágenes de perfil
        const formattedConversations = conversations.map(conv => ({
            ...conv,
            profilePic: conv.profilePic ? conv.profilePic.toString('base64') : null,
            lastMessageTime: conv.lastMessageTime ? new Date(conv.lastMessageTime).toISOString() : null,
            unreadCount: Number(conv.unreadCount) // Asegurar que sea un número
        }));
        
        res.json(formattedConversations);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener conversaciones', details: error.message });
    }
};

// Obtener mensajes entre dos usuarios
const getConversationMessages = async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Verificar si el usuario existe
        const userExists = await prisma.usuario.findUnique({
            where: { id: parseInt(userId) }
        });
        
        if (!userExists) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Obtener mensajes entre los dos usuarios
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { 
                        senderId: req.user.id,
                        receiverId: parseInt(userId)
                    },
                    {
                        senderId: parseInt(userId),
                        receiverId: req.user.id
                    }
                ]
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip,
            take: parseInt(limit),
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
        
        // Marcar como leídos los mensajes recibidos
        await prisma.message.updateMany({
            where: {
                senderId: parseInt(userId),
                receiverId: req.user.id,
                isRead: false
            },
            data: {
                isRead: true
            }
        });
        
        // Formatear mensajes
        const formattedMessages = messages.map(message => ({
            ...message,
            sender: {
                ...message.sender,
                profilePic: message.sender.profilePic ? message.sender.profilePic.toString('base64') : null
            },
            receiver: {
                ...message.receiver,
                profilePic: message.receiver.profilePic ? message.receiver.profilePic.toString('base64') : null
            }
        }));
        
        // Obtener el total de mensajes para la paginación
        const totalMessages = await prisma.message.count({
            where: {
                OR: [
                    { 
                        senderId: req.user.id,
                        receiverId: parseInt(userId)
                    },
                    {
                        senderId: parseInt(userId),
                        receiverId: req.user.id
                    }
                ]
            }
        });
        
        res.json({
            data: formattedMessages,
            pagination: {
                total: totalMessages,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalMessages / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener mensajes', details: error.message });
    }
};

// Obtener el conteo de mensajes no leídos
const getUnreadMessageCount = async (req, res) => {
    try {
        const count = await prisma.message.count({
            where: {
                receiverId: req.user.id,
                isRead: false
            }
        });
        
        res.json({ unreadCount: count });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener conteo de mensajes no leídos', details: error.message });
    }
};

// Marcar todos los mensajes de una conversación como leídos
const markConversationAsRead = async (req, res) => {
    try {
        const { userId } = req.params;
        
        await prisma.message.updateMany({
            where: {
                senderId: parseInt(userId),
                receiverId: req.user.id,
                isRead: false
            },
            data: {
                isRead: true
            }
        });
        
        res.json({ message: 'Mensajes marcados como leídos' });
    } catch (error) {
        res.status(500).json({ error: 'Error al marcar mensajes como leídos', details: error.message });
    }
};

// Eliminar un mensaje (solo el remitente puede eliminar)
const deleteMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        
        // Verificar si el mensaje existe y pertenece al usuario
        const message = await prisma.message.findUnique({
            where: {
                id: parseInt(messageId)
            }
        });
        
        if (!message) {
            return res.status(404).json({ error: 'Mensaje no encontrado' });
        }
        
        if (message.senderId !== req.user.id) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar este mensaje' });
        }
        
        // Eliminar mensaje
        await prisma.message.delete({
            where: {
                id: parseInt(messageId)
            }
        });
        
        res.json({ message: 'Mensaje eliminado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar mensaje', details: error.message });
    }
};

module.exports = {
    sendMessage,
    getUserConversations,
    getConversationMessages,
    getUnreadMessageCount,
    markConversationAsRead,
    deleteMessage
};