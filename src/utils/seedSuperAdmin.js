const bcrypt = require('bcryptjs');
const User = require('../models/User');

const seedSuperAdmin = async () => {
    try {
        const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@company.com';
        const existingSuperAdmin = await User.findOne({ email: superAdminEmail });

        if (!existingSuperAdmin) {
            console.log('Seeding default Super Admin account...');
            const salt = await bcrypt.genSalt(10);
            const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'WABEX_SUPER_SECRET_123!';
            const hashedPassword = await bcrypt.hash(superAdminPassword, salt);

            await User.create({
                email: superAdminEmail,
                password: hashedPassword,
                role: 'SUPER_ADMIN',
                clientId: null
            });
            console.log(`✅ Default Super Admin created (Email: ${superAdminEmail}, Pass: [HIDDEN])`);
        }
    } catch (error) {
        console.error('Failed to seed Super Admin:', error);
    }
};

module.exports = seedSuperAdmin;
