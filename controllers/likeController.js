const { PrismaClient } = require('@prisma/client');
const { socketManager } = require('../socketManager'); // Importar el socket manager
const prisma = new PrismaClient();

// Dar like a una publicación
const likePost = async (req, res) => {
    try {
        const { postId } = req.params;
        
        // Verificar si la publicación existe
        const post = await prisma.post.findUnique({
            where: {
                id: parseInt(postId)
            },
            include: {
                usuario: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            }
        });
        
        if (!post) {
            return res.status(404).json({ error: 'Publicación no encontrada' });
        }
        
        // Verificar si ya dio like
        const existingLike = await prisma.postLike.findUnique({
            where: {
                userId_postId: {
                    userId: req.user.id,
                    postId: parseInt(postId)
                }
            }
        });
        
        if (existingLike) {
            return res.status(400).json({ error: 'Ya has dado like a esta publicación' });
        }
        
        // Crear el like
        await prisma.postLike.create({
            data: {
                userId: req.user.id,
                postId: parseInt(postId)
            }
        });
        
        // Crear notificación en tiempo real para el autor de la publicación si es otro usuario
        if (post.userId !== req.user.id) {
            await socketManager.createNotification({
                type: 'like',
                userId: post.userId,
                fromUserId: req.user.id,
                postId: parseInt(postId),
                fromUsername: req.user.username
            });
        }
        
        // Obtener el nuevo conteo de likes
        const likeCount = await prisma.postLike.count({
            where: {
                postId: parseInt(postId)
            }
        });
        
        res.json({ 
            message: 'Like agregado correctamente',
            likeCount: likeCount
        });
    } catch (error) {
        console.error('Error al dar like:', error);
        res.status(500).json({ error: 'Error al dar like', details: error.message });
    }
};

// Quitar like de una publicación
const unlikePost = async (req, res) => {
    try {
        const { postId } = req.params;
        
        // Verificar si la publicación existe
        const postExists = await prisma.post.findUnique({
            where: {
                id: parseInt(postId)
            }
        });
        
        if (!postExists) {
            return res.status(404).json({ error: 'Publicación no encontrada' });
        }
        
        // Verificar si existe el like
        const like = await prisma.postLike.findUnique({
            where: {
                userId_postId: {
                    userId: req.user.id,
                    postId: parseInt(postId)
                }
            }
        });
        
        if (!like) {
            return res.status(400).json({ error: 'No has dado like a esta publicación' });
        }
        
        // Eliminar el like
        await prisma.postLike.delete({
            where: {
                userId_postId: {
                    userId: req.user.id,
                    postId: parseInt(postId)
                }
            }
        });
        
        // Obtener el nuevo conteo de likes
        const likeCount = await prisma.postLike.count({
            where: {
                postId: parseInt(postId)
            }
        });
        
        res.json({ 
            message: 'Like eliminado correctamente',
            likeCount: likeCount
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al quitar like', details: error.message });
    }
};

// Obtener usuarios que dieron like a una publicación
const getPostLikes = async (req, res) => {
    try {
        const { postId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Verificar si la publicación existe
        const postExists = await prisma.post.findUnique({
            where: {
                id: parseInt(postId)
            }
        });
        
        if (!postExists) {
            return res.status(404).json({ error: 'Publicación no encontrada' });
        }
        
        // Obtener los likes con información de usuario
        const likes = await prisma.postLike.findMany({
            where: {
                postId: parseInt(postId)
            },
            skip,
            take: parseInt(limit),
            include: {
                usuario: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true,
                        bio: true
                    }
                }
            }
        });
        
        // Formatear la respuesta
        const formattedLikes = likes.map(like => ({
            ...like,
            usuario: {
                ...like.usuario,
                profilePic: like.usuario.profilePic ? like.usuario.profilePic.toString('base64') : null
            }
        }));
        
        // Obtener el total de likes para la paginación
        const totalLikes = await prisma.postLike.count({
            where: {
                postId: parseInt(postId)
            }
        });
        
        res.json({
            data: formattedLikes,
            pagination: {
                total: totalLikes,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalLikes / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener likes', details: error.message });
    }
};

module.exports = {
    likePost,
    unlikePost,
    getPostLikes
};