const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Crear publicación
const createPost = async (req, res) => {
    try {
        const { description, categoryId } = req.body;
        const content = req.file ? req.file.buffer : null;
        
        if (!description) {
            return res.status(400).json({ error: 'La descripción es requerida' });
        }
        
        if (!categoryId) {
            return res.status(400).json({ error: 'La categoría es requerida' });
        }
        
        // Verificar si la categoría existe
        const categoryExists = await prisma.categoria.findUnique({
            where: { id: parseInt(categoryId) }
        });
        
        if (!categoryExists) {
            return res.status(404).json({ error: 'La categoría no existe' });
        }
        
        const newPost = await prisma.post.create({
            data: {
                description,
                content,
                userId: req.user.id,
                categoryId: parseInt(categoryId)
            },
            include: {
                usuario: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true
                    }
                },
                categoria: true
            }
        });
        
        // Crear notificaciones para los seguidores
        const followers = await prisma.userFollower.findMany({
            where: {
                followedId: req.user.id
            }
        });
        
        if (followers.length > 0) {
            await prisma.notification.createMany({
                data: followers.map(follower => ({
                    type: 'new_post',
                    userId: follower.followerId,
                    fromUserId: req.user.id,
                    postId: newPost.id
                }))
            });
        }
        
        // Formatear la respuesta
        const formattedPost = {
            ...newPost,
            content: newPost.content ? newPost.content.toString('base64') : null,
            usuario: {
                ...newPost.usuario,
                profilePic: newPost.usuario.profilePic ? newPost.usuario.profilePic.toString('base64') : null
            }
        };
        
        res.status(201).json(formattedPost);
    } catch (error) {
        res.status(500).json({ error: 'Error al crear la publicación', details: error.message });
    }
};

// Obtener publicaciones recientes
const getRecentPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const posts = await prisma.post.findMany({
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
                },
                categoria: true,
                _count: {
                    select: {
                        comentarios: true,
                        likes: true
                    }
                }
            }
        });
        
        // Verificar si el usuario actual ha dado like a cada publicación
        const postsWithLikeStatus = await Promise.all(posts.map(async (post) => {
            const hasLiked = await prisma.postLike.findUnique({
                where: {
                    userId_postId: {
                        userId: req.user.id,
                        postId: post.id
                    }
                }
            });
            
            return {
                ...post,
                content: post.content ? post.content.toString('base64') : null,
                usuario: {
                    ...post.usuario,
                    profilePic: post.usuario.profilePic ? post.usuario.profilePic.toString('base64') : null
                },
                hasLiked: !!hasLiked
            };
        }));
        
        // Obtener el total de publicaciones para la paginación
        const totalPosts = await prisma.post.count();
        
        res.json({
            data: postsWithLikeStatus,
            pagination: {
                total: totalPosts,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalPosts / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener publicaciones', details: error.message });
    }
};

// Obtener publicaciones de los usuarios que sigo
const getFeedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Obtener IDs de usuarios seguidos
        const following = await prisma.userFollower.findMany({
            where: {
                followerId: req.user.id
            },
            select: {
                followedId: true
            }
        });
        
        const followingIds = following.map(f => f.followedId);
        
        // Si no sigue a nadie, devolver publicaciones recientes
        if (followingIds.length === 0) {
            return getRecentPosts(req, res);
        }
        
        const posts = await prisma.post.findMany({
            where: {
                userId: {
                    in: followingIds
                }
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
                },
                categoria: true,
                _count: {
                    select: {
                        comentarios: true,
                        likes: true
                    }
                }
            }
        });
        
        // Verificar si el usuario actual ha dado like a cada publicación
        const postsWithLikeStatus = await Promise.all(posts.map(async (post) => {
            const hasLiked = await prisma.postLike.findUnique({
                where: {
                    userId_postId: {
                        userId: req.user.id,
                        postId: post.id
                    }
                }
            });
            
            return {
                ...post,
                content: post.content ? post.content.toString('base64') : null,
                usuario: {
                    ...post.usuario,
                    profilePic: post.usuario.profilePic ? post.usuario.profilePic.toString('base64') : null
                },
                hasLiked: !!hasLiked
            };
        }));
        
        // Obtener el total de publicaciones para la paginación
        const totalPosts = await prisma.post.count({
            where: {
                userId: {
                    in: followingIds
                }
            }
        });
        
        res.json({
            data: postsWithLikeStatus,
            pagination: {
                total: totalPosts,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalPosts / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener feed', details: error.message });
    }
};

// Obtener publicaciones por categoría
const getPostsByCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const posts = await prisma.post.findMany({
            where: {
                categoryId: parseInt(categoryId)
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
                },
                categoria: true,
                _count: {
                    select: {
                        comentarios: true,
                        likes: true
                    }
                }
            }
        });
        
        // Verificar si el usuario actual ha dado like a cada publicación
        const postsWithLikeStatus = await Promise.all(posts.map(async (post) => {
            const hasLiked = await prisma.postLike.findUnique({
                where: {
                    userId_postId: {
                        userId: req.user.id,
                        postId: post.id
                    }
                }
            });
            
            return {
                ...post,
                content: post.content ? post.content.toString('base64') : null,
                usuario: {
                    ...post.usuario,
                    profilePic: post.usuario.profilePic ? post.usuario.profilePic.toString('base64') : null
                },
                hasLiked: !!hasLiked
            };
        }));
        
        // Obtener el total de publicaciones para la paginación
        const totalPosts = await prisma.post.count({
            where: {
                categoryId: parseInt(categoryId)
            }
        });
        
        res.json({
            data: postsWithLikeStatus,
            pagination: {
                total: totalPosts,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalPosts / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener publicaciones por categoría', details: error.message });
    }
};

// Buscar publicaciones
const searchPosts = async (req, res) => {
    try {
        const { query } = req.query;
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        if (!query) {
            return res.status(400).json({ error: 'Se requiere un término de búsqueda' });
        }
        
        const posts = await prisma.post.findMany({
            where: {
                description: {
                    contains: query
                }
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
                },
                categoria: true,
                _count: {
                    select: {
                        comentarios: true,
                        likes: true
                    }
                }
            }
        });
        
        // Verificar si el usuario actual ha dado like a cada publicación
        const postsWithLikeStatus = await Promise.all(posts.map(async (post) => {
            const hasLiked = await prisma.postLike.findUnique({
                where: {
                    userId_postId: {
                        userId: req.user.id,
                        postId: post.id
                    }
                }
            });
            
            return {
                ...post,
                content: post.content ? post.content.toString('base64') : null,
                usuario: {
                    ...post.usuario,
                    profilePic: post.usuario.profilePic ? post.usuario.profilePic.toString('base64') : null
                },
                hasLiked: !!hasLiked
            };
        }));
        
        // Obtener el total de publicaciones para la paginación
        const totalPosts = await prisma.post.count({
            where: {
                description: {
                    contains: query
                }
            }
        });
        
        res.json({
            data: postsWithLikeStatus,
            pagination: {
                total: totalPosts,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalPosts / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al buscar publicaciones', details: error.message });
    }
};

// Obtener publicaciones de un usuario
const getUserPosts = async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const posts = await prisma.post.findMany({
            where: {
                userId: parseInt(userId)
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
                },
                categoria: true,
                _count: {
                    select: {
                        comentarios: true,
                        likes: true
                    }
                }
            }
        });
        
        // Verificar si el usuario actual ha dado like a cada publicación
        const postsWithLikeStatus = await Promise.all(posts.map(async (post) => {
            const hasLiked = await prisma.postLike.findUnique({
                where: {
                    userId_postId: {
                        userId: req.user.id,
                        postId: post.id
                    }
                }
            });
            
            return {
                ...post,
                content: post.content ? post.content.toString('base64') : null,
                usuario: {
                    ...post.usuario,
                    profilePic: post.usuario.profilePic ? post.usuario.profilePic.toString('base64') : null
                },
                hasLiked: !!hasLiked
            };
        }));
        
        // Obtener el total de publicaciones para la paginación
        const totalPosts = await prisma.post.count({
            where: {
                userId: parseInt(userId)
            }
        });
        
        res.json({
            data: postsWithLikeStatus,
            pagination: {
                total: totalPosts,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalPosts / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener publicaciones del usuario', details: error.message });
    }
};

// Obtener una publicación específica
const getPostById = async (req, res) => {
    try {
        const { postId } = req.params;
        
        const post = await prisma.post.findUnique({
            where: {
                id: parseInt(postId)
            },
            include: {
                usuario: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true
                    }
                },
                categoria: true,
                comentarios: {
                    include: {
                        usuario: {
                            select: {
                                id: true,
                                username: true,
                                profilePic: true
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                },
                _count: {
                    select: {
                        likes: true
                    }
                }
            }
        });
        
        if (!post) {
            return res.status(404).json({ error: 'Publicación no encontrada' });
        }
        
        // Verificar si el usuario actual ha dado like a la publicación
        const hasLiked = await prisma.postLike.findUnique({
            where: {
                userId_postId: {
                    userId: req.user.id,
                    postId: parseInt(postId)
                }
            }
        });
        
        // Formatear la publicación y comentarios
        const formattedPost = {
            ...post,
            content: post.content ? post.content.toString('base64') : null,
            usuario: {
                ...post.usuario,
                profilePic: post.usuario.profilePic ? post.usuario.profilePic.toString('base64') : null
            },
            comentarios: post.comentarios.map(comment => ({
                ...comment,
                usuario: {
                    ...comment.usuario,
                    profilePic: comment.usuario.profilePic ? comment.usuario.profilePic.toString('base64') : null
                }
            })),
            hasLiked: !!hasLiked
        };
        
        res.json(formattedPost);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener la publicación', details: error.message });
    }
};

// Actualizar publicación
const updatePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { description, categoryId } = req.body;
        const content = req.file ? req.file.buffer : undefined;
        
        // Verificar si la publicación existe y pertenece al usuario
        const post = await prisma.post.findUnique({
            where: {
                id: parseInt(postId)
            }
        });
        
        if (!post) {
            return res.status(404).json({ error: 'Publicación no encontrada' });
        }
        
        if (post.userId !== req.user.id) {
            return res.status(403).json({ error: 'No tienes permiso para editar esta publicación' });
        }
        
        // Verificar si la categoría existe si se proporcionó
        if (categoryId) {
            const categoryExists = await prisma.categoria.findUnique({
                where: { id: parseInt(categoryId) }
            });
            
            if (!categoryExists) {
                return res.status(404).json({ error: 'La categoría no existe' });
            }
        }
        
        // Preparar objeto de actualización
        const updateData = {};
        if (description) updateData.description = description;
        if (content) updateData.content = content;
        if (categoryId) updateData.categoryId = parseInt(categoryId);
        
        const updatedPost = await prisma.post.update({
            where: {
                id: parseInt(postId)
            },
            data: updateData,
            include: {
                usuario: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true
                    }
                },
                categoria: true
            }
        });
        
        // Formatear la respuesta
        const formattedPost = {
            ...updatedPost,
            content: updatedPost.content ? updatedPost.content.toString('base64') : null,
            usuario: {
                ...updatedPost.usuario,
                profilePic: updatedPost.usuario.profilePic ? updatedPost.usuario.profilePic.toString('base64') : null
            }
        };
        
        res.json(formattedPost);
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar la publicación', details: error.message });
    }
};

// Eliminar publicación
const deletePost = async (req, res) => {
    try {
        const { postId } = req.params;
        
        // Verificar si la publicación existe y pertenece al usuario
        const post = await prisma.post.findUnique({
            where: {
                id: parseInt(postId)
            }
        });
        
        if (!post) {
            return res.status(404).json({ error: 'Publicación no encontrada' });
        }
        
        if (post.userId !== req.user.id) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar esta publicación' });
        }
        
        // Eliminar la publicación
        await prisma.post.delete({
            where: {
                id: parseInt(postId)
            }
        });
        
        res.json({ message: 'Publicación eliminada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar la publicación', details: error.message });
    }
};

module.exports = {
    createPost,
    getRecentPosts,
    getFeedPosts,
    getPostsByCategory,
    searchPosts,
    getUserPosts,
    getPostById,
    updatePost,
    deletePost
};