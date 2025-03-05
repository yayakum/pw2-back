const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Obtener todas las notificaciones del usuario actual
const getUserNotifications = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const notifications = await prisma.notification.findMany({
            where: {
                userId: req.user.id
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip,
            take: parseInt(limit),
            include: {
                fromUser: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true
                    }
                },
                post: {
                    select: {
                        id: true,
                        description: true
                    }
                }
            }
        });
        
        // Formatear las notificaciones
        const formattedNotifications = notifications.map(notification => ({
            ...notification,
            fromUser: notification.fromUser 
                ? {
                    ...notification.fromUser,
                    profilePic: notification.fromUser.profilePic 
                        ? notification.fromUser.profilePic.toString('base64') 
                        : null
                  } 
                : null
        }));
        
        // Obtener el total de notificaciones para la paginación
        const totalNotifications = await prisma.notification.count({
            where: {
                userId: req.user.id
            }
        });
        
        res.json({
            data: formattedNotifications,
            pagination: {
                total: totalNotifications,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalNotifications / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener notificaciones', details: error.message });
    }
};

// Obtener el número de notificaciones no leídas
const getUnreadNotificationsCount = async (req, res) => {
    try {
        const count = await prisma.notification.count({
            where: {
                userId: req.user.id,
                isRead: false
            }
        });
        
        res.json({ unreadCount: count });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener conteo de notificaciones no leídas', details: error.message });
    }
};

// Marcar una notificación como leída
const markNotificationAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params;
        
        // Verificar si la notificación existe y pertenece al usuario
        const notification = await prisma.notification.findUnique({
            where: {
                id: parseInt(notificationId)
            }
        });
        
        if (!notification) {
            return res.status(404).json({ error: 'Notificación no encontrada' });
        }
        
        if (notification.userId !== req.user.id) {
            return res.status(403).json({ error: 'No tienes permiso para modificar esta notificación' });
        }
        
        // Actualizar la notificación
        const updatedNotification = await prisma.notification.update({
            where: {
                id: parseInt(notificationId)
            },
            data: {
                isRead: true
            }
        });
        
        res.json(updatedNotification);
    } catch (error) {
        res.status(500).json({ error: 'Error al marcar notificación como leída', details: error.message });
    }
};

// Marcar todas las notificaciones como leídas
const markAllNotificationsAsRead = async (req, res) => {
    try {
        await prisma.notification.updateMany({
            where: {
                userId: req.user.id,
                isRead: false
            },
            data: {
                isRead: true
            }
        });
        
        res.json({ message: 'Todas las notificaciones han sido marcadas como leídas' });
    } catch (error) {
        res.status(500).json({ error: 'Error al marcar todas las notificaciones como leídas', details: error.message });
    }
};

// Eliminar una notificación
const deleteNotification = async (req, res) => {
    try {
        const { notificationId } = req.params;
        
        // Verificar si la notificación existe y pertenece al usuario
        const notification = await prisma.notification.findUnique({
            where: {
                id: parseInt(notificationId)
            }
        });
        
        if (!notification) {
            return res.status(404).json({ error: 'Notificación no encontrada' });
        }
        
        if (notification.userId !== req.user.id) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar esta notificación' });
        }
        
        // Eliminar la notificación
        await prisma.notification.delete({
            where: {
                id: parseInt(notificationId)
            }
        });
        
        res.json({ message: 'Notificación eliminada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar notificación', details: error.message });
    }
};

// Eliminar todas las notificaciones
const deleteAllNotifications = async (req, res) => {
    try {
        await prisma.notification.deleteMany({
            where: {
                userId: req.user.id
            }
        });
        
        res.json({ message: 'Todas las notificaciones han sido eliminadas' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar todas las notificaciones', details: error.message });
    }
};

module.exports = {
    getUserNotifications,
    getUnreadNotificationsCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    deleteAllNotifications
};