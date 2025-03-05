const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Crear comentario
const createComment = async (req, res) => {
    try {
        const { postId } = req.params;
        const { content } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: 'El contenido del comentario es requerido' });
        }
        
        // Verificar si la publicación existe
        const post = await prisma.post.findUnique({
            where: {
                id: parseInt(postId)
            },
            include: {
                usuario: true
            }
        });
        
        if (!post) {
            return res.status(404).json({ error: 'Publicación no encontrada' });
        }
        
        // Crear el comentario
        const newComment = await prisma.comentario.create({
            data: {
                content,
                postId: parseInt(postId),
                userId: req.user.id
            },
            include: {
                usuario: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true
                    }
                }
            }
        });
        
        // Crear notificación para el autor de la publicación si es otro usuario
        if (post.userId !== req.user.id) {
            await prisma.notification.create({
                data: {
                    type: 'comment',
                    userId: post.userId,
                    fromUserId: req.user.id,
                    postId: parseInt(postId)
                }
            });
        }
        
        // Formatear la respuesta
        const formattedComment = {
            ...newComment,
            usuario: {
                ...newComment.usuario,
                profilePic: newComment.usuario.profilePic ? newComment.usuario.profilePic.toString('base64') : null
            }
        };
        
        res.status(201).json(formattedComment);
    } catch (error) {
        res.status(500).json({ error: 'Error al crear comentario', details: error.message });
    }
};

// Obtener comentarios de una publicación
const getPostComments = async (req, res) => {
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
        
        // Obtener comentarios
        const comments = await prisma.comentario.findMany({
            where: {
                postId: parseInt(postId)
            },
            skip,
            take: parseInt(limit),
            orderBy: {
                createdAt: 'desc'
            },
            include: {
                usuario: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true
                    }
                }
            }
        });
        
        // Formatear la respuesta
        const formattedComments = comments.map(comment => ({
            ...comment,
            usuario: {
                ...comment.usuario,
                profilePic: comment.usuario.profilePic ? comment.usuario.profilePic.toString('base64') : null
            }
        }));
        
        // Obtener el total de comentarios para la paginación
        const totalComments = await prisma.comentario.count({
            where: {
                postId: parseInt(postId)
            }
        });
        
        res.json({
            data: formattedComments,
            pagination: {
                total: totalComments,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalComments / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener comentarios', details: error.message });
    }
};

// Eliminar comentario
const deleteComment = async (req, res) => {
    try {
        const { commentId } = req.params;
        
        // Verificar si el comentario existe
        const comment = await prisma.comentario.findUnique({
            where: {
                id: parseInt(commentId)
            },
            include: {
                post: true
            }
        });
        
        if (!comment) {
            return res.status(404).json({ error: 'Comentario no encontrado' });
        }
        
        // Verificar si el usuario es el autor del comentario o de la publicación
        if (comment.userId !== req.user.id && comment.post.userId !== req.user.id) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar este comentario' });
        }
        
        // Eliminar el comentario
        await prisma.comentario.delete({
            where: {
                id: parseInt(commentId)
            }
        });
        
        res.json({ message: 'Comentario eliminado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar comentario', details: error.message });
    }
};

module.exports = {
    createComment,
    getPostComments,
    deleteComment
};