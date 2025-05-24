// Estructura básica de una API para red social con Node.js, Express y MySQL

// Dependencias necesarias
// npm install express mysql2 bcrypt jsonwebtoken multer cors
//Hola
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const corsMiddleware = require('./src/middleware/corsMiddleware.js');

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const http = require('http'); // Agregado para Socket.IO

// Importar controllers
const { register, login, getUserProfile, getOtherUserProfile, updateUserProfile, searchUsers, getAllUsersExceptCurrent} = require('./controllers/userController');
const { createPost, getRecentPosts, getFeedPosts, getPostsByCategory, searchPosts, getUserPosts, getPostById, updatePost, deletePost, getExplorePosts} = require('./controllers/postController');
const { createCategory, getCategoryById, getAllCategories } = require('./controllers/categoryController');
const { followUser, unfollowUser, getUserFollowers, getUserFollowing } = require('./controllers/followController');
const { likePost, unlikePost, getPostLikes } = require('./controllers/likeController');
const { getUserNotifications, getUnreadNotificationsCount, markNotificationAsRead, markAllNotificationsAsRead, deleteNotification, deleteAllNotifications } = require('./controllers/notificationController');
const { createComment, updateComment, getPostComments, deleteComment } = require('./controllers/commentController');
const { sendMessage, getUserConversations, getConversationMessages, getUnreadMessageCount, markConversationAsRead, deleteMessage } = require('./controllers/messageController');

// Importar el nuevo socketManager
const { socketManager } = require('./socketManager');

const app = express();
const server = http.createServer(app); // Crear servidor HTTP para Socket.IO
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'tu_clave_secreta'; // Cambiar en producción

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Límite de 10MB
});

// Middleware
app.use(express.json());
app.use(corsMiddleware);

// Middleware de autenticación
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.usuario.findUnique({ where: { id: decoded.userId } });
    
    if (!user) {
      throw new Error();
    }
    
    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).send({ error: 'Por favor autentícate' });
  }
};

// ENDPOINTS DE USUARIO

// Registro de usuario
app.post('/register', upload.single('profilePic'), register);

// Inicio de sesión
app.post('/login', login);

// Obtener perfil de usuario
app.get('/profile', auth, getUserProfile);

// Obtener perfil de otro usuario
app.get('/profile/:userId', auth, getOtherUserProfile);

// Actualizar perfil de usuario
app.put('/updateprofile', auth, upload.single('profilePic'), updateUserProfile);

// Buscar usuarios
app.get('/search', searchUsers);

// Obtener todos los usuarios excepto el actual
app.get('/getAllUsersExceptCurrent', auth, getAllUsersExceptCurrent);

//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// ENDPOINTS DE CATEGORIAS

// Crear categoría
app.post('/createCategory', createCategory);

// Obtener una categoría por ID
app.get('/getCategory/:categoryId', getCategoryById);

// Obtener todas las categorías
app.get('/getAllCategories', getAllCategories);

//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// ENDPOINTS DE PUBLICACIONES

// Crear publicación
app.post('/createPost', auth, upload.single('file'), createPost);

// Obtener publicaciones recientes
app.get('/getRecentPosts', auth, getRecentPosts);

// Obtener publicaciones de los usuarios que sigo
app.get('/getFeedPosts', auth, getFeedPosts);

// Obtener publicaciones por categoría
app.get('/getPostsByCategory/:categoryId', auth, getPostsByCategory);

// Buscar publicaciones
app.get('/searchPosts', auth, searchPosts);

// Obtener publicaciones de un usuario
app.get('/getUserPosts/:userId', auth, getUserPosts);

// Obtener una publicación específica
app.get('/getPostById/:postId', auth, getPostById);

// Actualizar publicación
app.put('/updatePost/:postId', auth, upload.single('file'), updatePost);

// Eliminar publicación
app.delete('/deletePost/:postId', auth, deletePost);

// Obtener publicaciones de no seguidos
app.get('/getExplorePosts', auth, getExplorePosts);

//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// ENDPOINTS DE NOTIFICACIONES

// Obtener todas las notificaciones del usuario actual
app.get('/getUserNoti', auth, getUserNotifications);

// Obtener el número de notificaciones no leídas
app.get('/getUnreadNotiCount', auth, getUnreadNotificationsCount);

// Marcar una notificación como leída
app.put('/markNotiAsRead/:notificationId', auth, markNotificationAsRead);

// Marcar todas las notificaciones como leídas
app.put('/markAllNotiAsRead', auth, markAllNotificationsAsRead);

// Eliminar una notificación
app.delete('/deleteNoti/:notificationId', auth, deleteNotification);

// Eliminar todas las notificaciones
app.delete('/deleteAllNoti', auth, deleteAllNotifications);

//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// ENDPOINTS DE SEGUIDORES

// Seguir a un usuario
app.post('/followUser/:userId', auth, followUser);

// Dejar de seguir a un usuario
app.delete('/unfollowUser/:userId', auth, unfollowUser);

// Obtener seguidores de un usuario
app.get('/getUserFollowers/:userId', auth, getUserFollowers);

// Obtener usuarios seguidos por un usuario
app.get('/getUserFollowing/:userId', auth, getUserFollowing);

//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// ENDPOINTS DE LIKES

// Dar like a una publicación
app.post('/likePost/:postId', auth, likePost);

// Quitar like de una publicación
app.delete('/unlikePost/:postId', auth, unlikePost);

// Obtener usuarios que dieron like a una publicación
app.get('/getPostLikes/:postId', getPostLikes);

//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// ENDPOINTS DE COMENTARIOS

// Crear comentario
app.post('/createComment/:postId', auth, createComment);

// Actualizar comentario (nuevo endpoint)
app.put('/updateComment/:commentId', auth, updateComment);

// Obtener comentarios de una publicación
app.get('/getPostComments/:postId', getPostComments);

// Eliminar comentario
app.delete('/deleteComment/:commentId', auth, deleteComment);

//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// ENDPOINTS DE MENSAJES

// Enviar un mensaje a otro usuario
app.post('/sendMessage', auth, sendMessage);

// Obtener conversaciones del usuario
app.get('/getUserConversations', auth, getUserConversations);

// Obtener mensajes entre dos usuarios
app.get('/getConversationMessages/:userId', auth, getConversationMessages);

// Obtener el conteo de mensajes no leídos
app.get('/getUnreadMessageCount', auth, getUnreadMessageCount);

// Marcar todos los mensajes de una conversación como leídos
app.put('/markConversationAsRead/:userId', auth, markConversationAsRead);

// Eliminar un mensaje (solo el remitente puede eliminar)
app.delete('/deleteMessage/:messageId', auth, deleteMessage);

//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// RUTA DE PRUEBA
app.get('/', (req, res) => {
  res.json({ 
    message: 'API funcionando con notificaciones en tiempo real',
    timestamp: new Date().toISOString(),
    socketConnections: Object.keys(socketManager.getConnectedUsers()).length
  });
});

// MIDDLEWARE DE MANEJO DE ERRORES
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// MIDDLEWARE PARA RUTAS NO ENCONTRADAS
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// INICIALIZAR SERVIDOR CON SOCKET.IO
server.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log(`📡 Socket.IO listo para notificaciones en tiempo real`);
});

// Inicializar el sistema de notificaciones en tiempo real
const io = socketManager.initialize(server);
console.log('✅ Sistema de notificaciones en tiempo real activado');

// Exportar para uso en otros módulos si es necesario
module.exports = { app, server, io, socketManager };