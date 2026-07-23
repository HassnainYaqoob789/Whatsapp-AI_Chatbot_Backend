require('dotenv').config();
const mongoose = require('mongoose');
const seedSuperAdmin = require('./src/utils/seedSuperAdmin');

async function resetDB() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected! Dropping database...');
        
        await mongoose.connection.db.dropDatabase();
        console.log('Database dropped successfully.');
        
        console.log('Running super admin seeder...');
        await seedSuperAdmin();
        
        console.log('Done!');
        process.exit(0);
    } catch (error) {
        console.error('Error resetting database:', error);
        process.exit(1);
    }
}

resetDB();
