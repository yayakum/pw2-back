const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const SECRET_KEY = 'tu_clave_secreta';

// Registro de usuario-------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const register = async (req, res) => {
    const { username, email, password } = req.body;
    try {
        // Verificar si el usuario ya existe
        const existingUser = await prisma.usuario.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'El correo ya está registrado' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await prisma.usuario.create({
            data: {
                username,
                email,
                password: hashedPassword,
            },
        });
        res.status(201).json({ message: 'Usuario registrado con éxito' });
    } catch (error) {
        res.status(400).json({ error: 'Error al registrar usuario', details: error.message });
    }
};

// Inicio de sesión-------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.usuario.findUnique({ where: { email } });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Contraseña incorrecta' });

        const token = jwt.sign({ userId: user.id }, SECRET_KEY, { expiresIn: '1h' });
        res.json({ token, userId: user.id, username: user.username });
    } catch (error) {
        res.status(500).json({ error: 'Error en el inicio de sesión' });
    }
};

// Obtener perfil de usuario
const getUserProfile = async (req, res) => {
    try {
        const user = await prisma.usuario.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                username: true,
                email: true,
                bio: true,
                profilePic: true,
                createdAt: true,
                _count: {
                    select: {
                        posts: true,
                        seguidores: true,
                        seguidos: true
                    }
                }
            }
        });
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Convertir la imagen de perfil a base64 si existe
        const userProfile = {
            ...user,
            profilePic: user.profilePic ? user.profilePic.toString('base64') : null
        };
        
        res.json(userProfile);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener perfil', details: error.message });
    }
};

// Obtener perfil de otro usuario
const getOtherUserProfile = async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await prisma.usuario.findUnique({
            where: { id: parseInt(userId) },
            select: {
                id: true,
                username: true,
                bio: true,
                profilePic: true,
                createdAt: true,
                _count: {
                    select: {
                        posts: true,
                        seguidores: true,
                        seguidos: true
                    }
                }
            }
        });
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar si el usuario actual sigue a este usuario
        const isFollowing = await prisma.userFollower.findUnique({
            where: {
                followerId_followedId: {
                    followerId: req.user.id,
                    followedId: parseInt(userId)
                }
            }
        });
        
        // Convertir la imagen de perfil a base64 si existe
        const userProfile = {
            ...user,
            profilePic: user.profilePic ? user.profilePic.toString('base64') : null,
            isFollowing: !!isFollowing
        };
        
        res.json(userProfile);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener perfil', details: error.message });
    }
};

// Actualizar perfil de usuario
const updateUserProfile = async (req, res) => {
    try {
        const { username, bio, password } = req.body;
        const profilePic = req.file ? req.file.buffer : undefined;
        
        // Comprobar si el nombre de usuario ya existe (si se cambió)
        if (username && username !== req.user.username) {
            const existingUser = await prisma.usuario.findUnique({ 
                where: { 
                    username,
                    NOT: { id: req.user.id }
                } 
            });
            
            if (existingUser) {
                return res.status(400).json({ error: 'El nombre de usuario ya está en uso' });
            }
        }
        
        // Preparar objeto de actualización
        const updateData = {};
        if (username) updateData.username = username;
        if (bio !== undefined) updateData.bio = bio;
        if (profilePic) updateData.profilePic = profilePic;
        
        // Validar y actualizar la contraseña si se proporciona
        if (password) {
            /*if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
                return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres, una mayúscula, un número y un carácter especial.' });
            }*/
            
            const hashedPassword = await bcrypt.hash(password, 10);
            updateData.password = hashedPassword;
        }
        
        const updatedUser = await prisma.usuario.update({
            where: { id: req.user.id },
            data: updateData,
            select: {
                id: true,
                username: true,
                email: true,
                bio: true,
                profilePic: true
            }
        });
        
        // Convertir la imagen de perfil a base64 si existe
        const userProfile = {
            ...updatedUser,
            profilePic: updatedUser.profilePic ? updatedUser.profilePic.toString('base64') : null
        };
        
        res.json(userProfile);
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar perfil', details: error.message });
    }
};


// Buscar usuarios
const searchUsers = async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query) {
            return res.status(400).json({ error: 'Se requiere un término de búsqueda' });
        }
        
        const users = await prisma.usuario.findMany({
            where: {
                OR: [
                    { username: { contains: query } },
                    { email: { contains: query } }
                ]
            },
            select: {
                id: true,
                username: true,
                profilePic: true,
                bio: true
            },
            take: 20 // Limitar a 20 resultados
        });
        
        // Convertir imágenes de perfil a base64
        const formattedUsers = users.map(user => ({
            ...user,
            profilePic: user.profilePic ? user.profilePic.toString('base64') : null
        }));
        
        res.json(formattedUsers);
    } catch (error) {
        res.status(500).json({ error: 'Error al buscar usuarios', details: error.message });
    }
};

module.exports = { 
    register, 
    login, 
    getUserProfile, 
    getOtherUserProfile, 
    updateUserProfile, 
    searchUsers 
};