const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Crear categoría
const createCategory = async (req, res) => {
    try {
        const { nombre, descripcion } = req.body;
        
        if (!nombre) {
            return res.status(400).json({ error: 'El nombre de la categoría es requerido' });
        }
        
        // Verificar si la categoría ya existe
        const existingCategory = await prisma.categoria.findUnique({
            where: { nombre }
        });
        
        if (existingCategory) {
            return res.status(400).json({ error: 'La categoría ya existe' });
        }
        
        const newCategory = await prisma.categoria.create({
            data: {
                nombre,
                descripcion
            }
        });
        
        res.status(201).json(newCategory);
    } catch (error) {
        res.status(500).json({ error: 'Error al crear categoría', details: error.message });
    }
};

// Obtener una categoría por ID
const getCategoryById = async (req, res) => {
    try {
        const { categoryId } = req.params;
        
        const category = await prisma.categoria.findUnique({
            where: {
                id: parseInt(categoryId)
            }
        });
        
        if (!category) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }
        
        res.json(category);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener categoría', details: error.message });
    }
};

// Obtener todas las categorías
const getAllCategories = async (req, res) => {
    try {
        const categories = await prisma.categoria.findMany({
            orderBy: {
                nombre: 'asc'
            }
        });
        
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener categorías', details: error.message });
    }
};

module.exports = {
    createCategory,
    getCategoryById,
    getAllCategories
};