const bcrypt = require('bcryptjs');
const User = require('../models/User');

const seedSuperAdmin = async () => {
    try {
        const superAdminEmail = 'superadmin@company.com';
        const existingSuperAdmin = await User.findOne({ email: superAdminEmail });

        if (!existingSuperAdmin) {
            console.log('Seeding default Super Admin account...');
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('superadmin123', salt);

            await User.create({
                email: superAdminEmail,
                password: hashedPassword,
                role: 'SUPER_ADMIN',
                clientId: null
            });
            console.log('✅ Default Super Admin created (Email: superadmin@company.com, Pass: superadmin123)');
        }
    } catch (error) {
        console.error('Failed to seed Super Admin:', error);
    }
};

module.exports = seedSuperAdmin;
