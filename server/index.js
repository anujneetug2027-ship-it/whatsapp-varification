const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const schedule = require('node-schedule');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://ambikashelf:anuj%23678@cluster0.pulil65.mongodb.net/security_education?retryWrites=true&w=majority', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// User Schema
const userSchema = new mongoose.Schema({
    name: String,
    phone: { type: String, unique: true },
    password: String,
    isVerified: { type: Boolean, default: false },
    verificationToken: String,
    verificationExpires: Date,
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Fast2SMS Configuration
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || 'sfVfVfLJvbuETW31XwZllhYEBQeOShtTqixiwAixx5hlwlz';

// Send WhatsApp Message
async function sendWhatsAppMessage(phone, message) {
    try {
        const url = `https://www.fast2sms.com/dev/wapp/api/send?authorization=${FAST2SMS_API_KEY}&sender_id=FSTSMS&message=${encodeURIComponent(message)}&numbers=${phone.replace('+', '')}&language=english&route=w`;
        
        const response = await axios.get(url);
        console.log('Message sent to', phone, response.data);
        return response.data;
    } catch (error) {
        console.error('Error sending WhatsApp:', error);
        throw error;
    }
}

// Generate Verification Token
function generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
}

// 1. REGISTER ENDPOINT
app.post('/api/register', async (req, res) => {
    try {
        const { name, phone, password } = req.body;
        
        // Check if user exists
        const existingUser = await User.findOne({ phone });
        if (existingUser) {
            return res.json({ success: false, message: 'Phone number already registered' });
        }
        
        // Generate verification token
        const verificationToken = generateVerificationToken();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        // Create user
        const user = new User({
            name,
            phone,
            password,
            verificationToken,
            verificationExpires,
            isVerified: false
        });
        await user.save();
        
        // Send WhatsApp verification
        const verificationLink = `https://${req.headers.host}/verify.html?token=${verificationToken}`;
        const whatsappMessage = `Welcome to AmbikaShelf! 👋\n\nClick to verify your account:\n${verificationLink}\n\nOr copy this code: ${verificationToken}`;
        
        await sendWhatsAppMessage(phone, whatsappMessage);
        
        // Schedule reminder after 10 hours
        schedule.scheduleJob(new Date(Date.now() + 10 * 60 * 60 * 1000), async () => {
            try {
                const reminderUser = await User.findById(user._id);
                if (reminderUser && reminderUser.isVerified) {
                    const reminderMessage = `Hello ${name}! 👋\n\nExplore AmbikaShelf products now:\nhttps://ambikashelf.com\n\nClick: https://ambikashelf.com/explore`;
                    await sendWhatsAppMessage(phone, reminderMessage);
                }
            } catch (err) {
                console.error('Reminder error:', err);
            }
        });
        
        res.json({ 
            success: true, 
            message: 'Verification link sent to WhatsApp!',
            token: verificationToken 
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 2. VERIFY ENDPOINT
app.post('/api/verify', async (req, res) => {
    try {
        const { token } = req.body;
        
        const user = await User.findOne({ 
            verificationToken: token,
            verificationExpires: { $gt: new Date() }
        });
        
        if (!user) {
            return res.json({ success: false, message: 'Invalid or expired token' });
        }
        
        user.isVerified = true;
        user.verificationToken = undefined;
        user.verificationExpires = undefined;
        await user.save();
        
        res.json({ 
            success: true, 
            message: 'Account verified successfully!',
            user: { name: user.name, phone: user.phone }
        });
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 3. LOGIN ENDPOINT
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        
        const user = await User.findOne({ phone, password });
        if (!user) {
            return res.json({ success: false, message: 'Invalid credentials' });
        }
        
        if (!user.isVerified) {
            // Resend verification
            const verificationLink = `https://${req.headers.host}/verify.html?token=${user.verificationToken}`;
            const whatsappMessage = `Your verification link:\n${verificationLink}`;
            await sendWhatsAppMessage(phone, whatsappMessage);
            
            return res.json({ 
                success: false, 
                message: 'Account not verified. New link sent to WhatsApp.' 
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Login successful!',
            user: { name: user.name, phone: user.phone }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 4. CHECK VERIFICATION STATUS
app.get('/api/check-verification/:token', async (req, res) => {
    try {
        const { token } = req.params;
        
        const user = await User.findOne({ verificationToken: token });
        if (!user) {
            return res.json({ exists: false });
        }
        
        res.json({ 
            exists: true,
            name: user.name,
            phone: user.phone,
            isVerified: user.isVerified
        });
    } catch (error) {
        console.error('Check error:', error);
        res.status(500).json({ exists: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in browser`);
});
