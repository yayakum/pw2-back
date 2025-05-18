const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Función auxiliar mejorada para formatear los datos de las publicaciones
const formatPostData = (post, userId = null) => {
    // Verificar si post es nulo o indefinido
    if (!post) return null;
    
    // Función para manejar Buffer correctamente
    const formatBuffer = (buffer) => {
        if (!buffer) return null;
        // Asegurarse de que buffer es una instancia de Buffer
        const bufferData = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        return bufferData.toString('base64');
    };
    
    // Crear objeto base
    const formattedPost = {
        ...post,
        // Convertir contenido binario a base64 solo si existe
        content: post.content ? formatBuffer(post.content) : null,
        contentType: post.contentType || null,
    };
    
    // Formatear datos del usuario si existen
    if (post.usuario) {
        formattedPost.usuario = {
            ...post.usuario,
            profilePic: post.usuario.profilePic ? formatBuffer(post.usuario.profilePic) : null
        };
    }
    
    // Parsear emojiData si existe y es string
    if (post.emojiData) {
        try {
            formattedPost.emojiData = typeof post.emojiData === 'string' ? 
                JSON.parse(post.emojiData) : post.emojiData;
        } catch (e) {
            console.warn('Error al parsear emojiData:', e);
            formattedPost.emojiData = post.emojiData;
        }
    }
    
    // Verificar si el usuario ha dado like
    if (userId && post.likes) {
        formattedPost.hasLiked = post.likes.some(like => like.userId === parseInt(userId));
    }
    
    return formattedPost;
};

// Crear publicación
const createPost = async (req, res) => {
    try {
        console.log("Body recibido:", req.body);
        console.log("Archivo recibido:", req.file);
        
        const { description, categoryId, emoji } = req.body;
        const content = req.file ? req.file.buffer : null;
        const contentType = req.file ? req.file.mimetype : null;
        
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
        
        // Procesar emoji si está presente
        let emojiData = null;
        if (emoji) {
            try {
                // Si es string, asumimos que ya es JSON, si no, lo convertimos
                emojiData = typeof emoji === 'string' ? emoji : JSON.stringify(emoji);
            } catch (e) {
                console.error("Error procesando emoji:", e);
            }
        }
        
        const newPost = await prisma.post.create({
            data: {
                description,
                content,
                contentType,
                emojiData,
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
        
        // Formatear la respuesta usando la función auxiliar
        const formattedPost = formatPostData(newPost);
        
        res.status(201).json(formattedPost);
    } catch (error) {
        console.error('Error al crear publicación:', error);
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
                likes: {
                    where: {
                        userId: req.user.id
                    },
                    select: {
                        userId: true
                    }
                },
                _count: {
                    select: {
                        comentarios: true,
                        likes: true
                    }
                }
            }
        });
        
        // Formatear todas las publicaciones utilizando la función auxiliar
        const formattedPosts = posts.map(post => formatPostData(post, req.user.id));
        
        // Obtener el total de publicaciones para la paginación
        const totalPosts = await prisma.post.count();
        
        res.json({
            data: formattedPosts,
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
                likes: {
                    where: {
                        userId: req.user.id
                    },
                    select: {
                        userId: true
                    }
                },
                _count: {
                    select: {
                        comentarios: true,
                        likes: true
                    }
                }
            }
        });
        
        // Formatear todas las publicaciones utilizando la función auxiliar
        const formattedPosts = posts.map(post => formatPostData(post, req.user.id));
        
        // Obtener el total de publicaciones para la paginación
        const totalPosts = await prisma.post.count({
            where: {
                userId: {
                    in: followingIds
                }
            }
        });
        
        res.json({
            data: formattedPosts,
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
                likes: {
                    where: {
                        userId: req.user.id
                    },
                    select: {
                        userId: true
                    }
                },
                _count: {
                    select: {
                        comentarios: true,
                        likes: true
                    }
                }
            }
        });
        
        // Formatear todas las publicaciones utilizando la función auxiliar
        const formattedPosts = posts.map(post => formatPostData(post, req.user.id));
        
        // Obtener el total de publicaciones para la paginación
        const totalPosts = await prisma.post.count({
            where: {
                categoryId: parseInt(categoryId)
            }
        });
        
        res.json({
            data: formattedPosts,
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
                likes: {
                    where: {
                        userId: req.user.id
                    },
                    select: {
                        userId: true
                    }
                },
                _count: {
                    select: {
                        comentarios: true,
                        likes: true
                    }
                }
            }
        });
        
        // Formatear todas las publicaciones utilizando la función auxiliar
        const formattedPosts = posts.map(post => formatPostData(post, req.user.id));
        
        // Obtener el total de publicaciones para la paginación
        const totalPosts = await prisma.post.count({
            where: {
                description: {
                    contains: query
                }
            }
        });
        
        res.json({
            data: formattedPosts,
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
                likes: {
                    where: {
                        userId: req.user.id
                    },
                    select: {
                        userId: true
                    }
                },
                _count: {
                    select: {
                        comentarios: true,
                        likes: true
                    }
                }
            }
        });
        
        // Formatear todas las publicaciones utilizando la función auxiliar
        const formattedPosts = posts.map(post => formatPostData(post, req.user.id));
        
        // Obtener el total de publicaciones para la paginación
        const totalPosts = await prisma.post.count({
            where: {
                userId: parseInt(userId)
            }
        });
        
        res.json({
            data: formattedPosts,
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
                likes: {
                    where: {
                        userId: req.user.id
                    },
                    select: {
                        userId: true
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
        
        // Formatear la publicación usando la función auxiliar
        const formattedPost = formatPostData(post, req.user.id);
        
        // Formatear también los comentarios
        formattedPost.comentarios = post.comentarios.map(comment => ({
            ...comment,
            usuario: {
                ...comment.usuario,
                profilePic: comment.usuario.profilePic ? comment.usuario.profilePic.toString('base64') : null
            }
        }));
        
        res.json(formattedPost);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener la publicación', details: error.message });
    }
};

// Actualizar publicación
const updatePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { description, categoryId, emoji, removeEmoji, removeMedia } = req.body;
        
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
        
        // Actualizar descripción si se proporcionó
        if (description !== undefined) {
            updateData.description = description;
        }
        
        // Actualizar categoría si se proporcionó
        if (categoryId !== undefined) {
            updateData.categoryId = parseInt(categoryId);
        }
        
        // Procesar emoji
        if (emoji) {
            try {
                updateData.emojiData = typeof emoji === 'string' ? emoji : JSON.stringify(emoji);
            } catch (e) {
                console.error("Error procesando emoji:", e);
            }
        } else if (removeEmoji === 'true') {
            // Si se indicó explícitamente eliminar el emoji
            updateData.emojiData = null;
            console.log("Eliminando emoji de la publicación");
        }
        
        // Manejar archivo multimedia
        if (req.file) {
            // Si hay un nuevo archivo, usarlo
            updateData.content = req.file.buffer;
            updateData.contentType = req.file.mimetype;
            console.log("Actualizando con nuevo archivo:", req.file.mimetype);
        } else if (removeMedia === 'true') {
            // Si se indicó eliminar el multimedia
            updateData.content = null;
            updateData.contentType = null;
            console.log("Eliminando archivo multimedia");
        }
        
        console.log("Datos a actualizar:", Object.keys(updateData));
        
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
        
        // Formatear la respuesta usando la función auxiliar
        const formattedPost = formatPostData(updatedPost);
        
        res.json(formattedPost);
    } catch (error) {
        console.error('Error completo al actualizar:', error);
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

const getExplorePosts = async (req, res) => {
    try {
        const { search, category, since } = req.query;
        const userId = req.user.id;

        // Obtener IDs de usuarios que el usuario actual sigue
        const following = await prisma.userFollower.findMany({
            where: {
                followerId: userId
            },
            select: {
                followedId: true
            }
        });

        const followingIds = following.map(follow => follow.followedId);

        // Consulta base para excluir publicaciones del usuario actual y usuarios seguidos
        let whereClause = {
            NOT: [
                { userId: userId }
            ]
        };

        // Añadir usuarios seguidos al filtro NOT si hay alguno
        if (followingIds.length > 0) {
            whereClause.NOT.push({ userId: { in: followingIds } });
        }

        // Filtrar por término de búsqueda si se proporciona
        if (search) {
            whereClause.description = {
                contains: search
            };
        }

        // Filtrar por categoría si se proporciona
        if (category) {
            whereClause.categoryId = parseInt(category);
        }

        // Filtrar por tiempo si se proporciona
        if (since) {
            whereClause.createdAt = {
                gte: new Date(since)
            };
        }

        // Obtener publicaciones con filtros
        const posts = await prisma.post.findMany({
            where: whereClause,
            include: {
                usuario: {
                    select: {
                        id: true,
                        username: true,
                        profilePic: true
                    }
                },
                _count: {
                    select: {
                        likes: true,
                        comentarios: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Usar la función formatPostData para cada publicación
        const formattedPosts = posts.map(post => {
            const formattedPost = formatPostData(post, userId);
            
            // Verificar si el usuario ha dado like (mantener esta funcionalidad)
            return {
                ...formattedPost,
                hasLiked: post.hasLiked || false
            };
        });

        res.json({ data: formattedPosts });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener publicaciones para explorar', details: error.message });
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
    deletePost,
    getExplorePosts
};