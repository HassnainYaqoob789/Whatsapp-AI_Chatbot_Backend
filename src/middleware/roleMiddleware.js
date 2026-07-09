const requireSuperAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (req.user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, message: 'Forbidden: Super Admin access required.' });
    }

    next();
};

module.exports = {
    requireSuperAdmin
};
