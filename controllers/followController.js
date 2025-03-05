const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Seguir a un usuario
const followUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const followedId = parseInt(userId);
        
        // Verificar que no intente seguirse a sí mismo
        if (req.user.id === followedId) {
            return res.status(400).json({ error: 'No puedes seguirte a ti mismo' });
        }
        
        // Verificar si el usuario a seguir existe
        const userToFollow = await prisma.usuario.findUnique({
            where: {
                id: followedId
            }
        });
        
        if (!userToFollow) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar si ya sigue a este usuario
        const existingFollow = await prisma.userFollower.findUnique({
            where: {
                followerId_followedId: {
                    followerId: req.user.id,
                    followedId: followedId
                }
            }
        });
        
        if (existingFollow) {
            return res.status(400).json({ error: 'Ya sigues a este usuario' });
        }
        
        // Crear la relación de seguidor
        await prisma.userFollower.create({
            data: {
                followerId: req.user.id,
                followedId: followedId
            }
        });
        
        // Crear notificación
        await prisma.notification.create({
            data: {
                type: 'follow',
                userId: followedId,
                fromUserId: req.user.id
            }
        });
        
        // Obtener recuentos actualizados
        const followerCount = await prisma.userFollower.count({
            where: {
                followedId: followedId
            }
        });
        
        res.json({ 
            message: 'Usuario seguido correctamente',
            followerCount: followerCount 
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al seguir usuario', details: error.message });
    }
};

// Dejar de seguir a un usuario
const unfollowUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const followedId = parseInt(userId);
        
        // Verificar si el usuario a dejar de seguir existe
        const userExists = await prisma.usuario.findUnique({
            where: {
                id: followedId
            }
        });
        
        if (!userExists) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar si existe la relación de seguidor
        const follow = await prisma.userFollower.findUnique({
            where: {
                followerId_followedId: {
                    followerId: req.user.id,
                    followedId: followedId
                }
            }
        });
        
        if (!follow) {
            return res.status(400).json({ error: 'No sigues a este usuario' });
        }
        
        // Eliminar la relación de seguidor
        await prisma.userFollower.delete({
            where: {
                followerId_followedId: {
                    followerId: req.user.id,
                    followedId: followedId
                }
            }
        });
        
        // Obtener recuentos actualizados
        const followerCount = await prisma.userFollower.count({
            where: {
                followedId: followedId
            }
        });
        
        res.json({ 
            message: 'Has dejado de seguir al usuario',
            followerCount: followerCount 
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al dejar de seguir usuario', details: error.message });
    }
};

// Obtener seguidores de un usuario
const getUserFollowers = async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Verificar si el usuario existe
        const userExists = await prisma.usuario.findUnique({
            where: {
                id: parseInt(userId)
            }
        });
        
        if (!userExists) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Obtener los seguidores
        const followers = await prisma.userFollower.findMany({
            where: {
                followedId: parseInt(userId)
            },
            skip,
            take: parseInt(limit),
            include: {
                seguidor: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true,
                        bio: true
                    }
                }
            }
        });
        
        // Verificar si el usuario actual sigue a cada seguidor
        const followersWithStatus = await Promise.all(followers.map(async (follower) => {
            const isFollowing = await prisma.userFollower.findUnique({
                where: {
                    followerId_followedId: {
                        followerId: req.user.id,
                        followedId: follower.seguidor.id
                    }
                }
            });
            
            return {
                ...follower,
                seguidor: {
                    ...follower.seguidor,
                    profilePic: follower.seguidor.profilePic ? follower.seguidor.profilePic.toString('base64') : null,
                    isFollowing: !!isFollowing
                }
            };
        }));
        
        // Obtener el total de seguidores para la paginación
        const totalFollowers = await prisma.userFollower.count({
            where: {
                followedId: parseInt(userId)
            }
        });
        
        res.json({
            data: followersWithStatus,
            pagination: {
                total: totalFollowers,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalFollowers / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener seguidores', details: error.message });
    }
};

// Obtener usuarios seguidos por un usuario
const getUserFollowing = async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Verificar si el usuario existe
        const userExists = await prisma.usuario.findUnique({
            where: {
                id: parseInt(userId)
            }
        });
        
        if (!userExists) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Obtener los usuarios seguidos
        const following = await prisma.userFollower.findMany({
            where: {
                followerId: parseInt(userId)
            },
            skip,
            take: parseInt(limit),
            include: {
                seguido: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true,
                        bio: true
                    }
                }
            }
        });
        
        // Verificar si el usuario actual sigue a cada usuario seguido
        const followingWithStatus = await Promise.all(following.map(async (follow) => {
            const isFollowing = await prisma.userFollower.findUnique({
                where: {
                    followerId_followedId: {
                        followerId: req.user.id,
                        followedId: follow.seguido.id
                    }
                }
            });
            
            return {
                ...follow,
                seguido: {
                    ...follow.seguido,
                    profilePic: follow.seguido.profilePic ? follow.seguido.profilePic.toString('base64') : null,
                    isFollowing: !!isFollowing
                }
            };
        }));
        
        // Obtener el total de seguidos para la paginación
        const totalFollowing = await prisma.userFollower.count({
            where: {
                followerId: parseInt(userId)
            }
        });
        
        res.json({
            data: followingWithStatus,
            pagination: {
                total: totalFollowing,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalFollowing / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener usuarios seguidos', details: error.message });
    }
};

module.exports = {
    followUser,
    unfollowUser,
    getUserFollowers,
    getUserFollowing
};