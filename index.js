require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Connect to Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// CONFIGURATION: Removed COLLEGE_DOMAIN variable as we accept all domains now.

// --- HELPER: NOTIFICATION SYSTEM ---
async function createNotification(userId, title, message, type = 'info', targetId = null) {
    try {
        await supabase.from('notifications').insert([{ 
            user_id: userId, 
            title, 
            message, 
            is_read: false,
            type,
            target_id: targetId 
        }]);
    } catch (err) { console.log("Notif Error:", err); }
}

// ==========================================
// 1. AUTHENTICATION (Global Multi-Campus)
// ==========================================
app.post('/login', async (req, res) => {
    const { phone, name, department, year, email } = req.body;
    
    let { data: user } = await supabase.from('users').select('*').eq('phone', phone).single();

    if (!user) {
        // VITAL: Now only checks if email exists (Any domain is accepted)
        if (!email) return res.status(400).json({ error: "College Email is required." });
        
        // Extract the domain for the Profile Badge (e.g., kpriet.ac.in)
        const domainPart = email.split('@')[1]; 

        const { data: newUser, error } = await supabase
            .from('users')
            .insert([{ 
                name, phone, department, year, email, 
                status: 'available', is_verified: true, rating_avg: 5.0,
                college_domain: domainPart // Saves the unique campus identity
            }])
            .select().single();
            
        if (error) return res.status(400).json({ error: error.message });
        user = newUser;
    }
    res.json(user);
});

// ==========================================
// 2. NOTIFICATIONS API
// ==========================================
app.get('/notifications/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

app.put('/notifications/:id/read', async (req, res) => {
    const { id } = req.params;
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    res.json({ success: true });
});

// ==========================================
// 3. TASK MARKETPLACE
// ==========================================
app.get('/tasks', async (req, res) => {
    const { category } = req.query;
    let query = supabase.from('tasks').select('*, users!created_by(name, department, rating_avg, is_verified, college_domain)').eq('status', 'open').order('created_at', { ascending: false });

    if (category && category !== 'All') query = query.eq('category', category);

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

app.post('/tasks', async (req, res) => {
    const { created_by, title, description, price, location, urgency, category } = req.body;
    const { data, error } = await supabase.from('tasks').insert([{ 
        created_by, title, description, price, location, urgency, 
        category: category || 'General', status: 'open' 
    }]).select();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

app.put('/tasks/:taskId/complete', async (req, res) => {
    const { taskId } = req.params;
    
    const { data: task, error } = await supabase
        .from('tasks')
        .update({ status: 'completed' })
        .eq('id', taskId)
        .select()
        .single();

    if (error) return res.status(400).json({ error: error.message });

    // Notify the Creator
    await createNotification(task.created_by, "Task Completed", `Task "${task.title}" is marked as done.`, 'task', task.id);
    
    res.json({ message: 'Task Completed' });
});

// ==========================================
// 4. HELPERS & DIRECT REQUESTS
// ==========================================
app.get('/search/helpers', async (req, res) => {
    const { skill, query } = req.query;
    
    let dbQuery = supabase.from('users').select('id, name, department, rating_avg, skills, status, tasks_completed, college_domain').eq('status', 'available').order('rating_avg', { ascending: false });

    if (skill && skill !== 'All') dbQuery = dbQuery.contains('skills', [skill]);
    if (query) dbQuery = dbQuery.ilike('name', `%${query}%`);

    const { data, error } = await dbQuery;
    res.json(data || []);
});

app.get('/helpers', async (req, res) => {
    const { data } = await supabase.from('users').select('id, name, rating_avg, status').eq('status', 'available').order('rating_avg', { ascending: false }).limit(10);
    res.json(data || []);
});

app.post('/direct-requests', async (req, res) => {
    const { sender_id, receiver_id, message, price, location } = req.body;
    
    const { data, error } = await supabase.from('direct_requests').insert([{ sender_id, receiver_id, message, price_offer: price, location_offer: location, status: 'pending' }]).select().single();
    
    if (error) return res.status(400).json({ error: error.message });

    // Notify Receiver with Deep Link Data
    await createNotification(receiver_id, "New Job Request", `Offer: ₹${price} - ${message}`, 'request', data.id);

    res.json(data);
});

app.post('/direct-requests/:id/convert', async (req, res) => {
    const { id } = req.params;
    const { data: reqData } = await supabase.from('direct_requests').select('*').eq('id', id).single();
    
    const { data: task } = await supabase
        .from('tasks')
        .insert([{
            created_by: reqData.sender_id,
            assigned_to: reqData.receiver_id,
            title: "Direct: " + reqData.message.substring(0,15),
            description: reqData.message,
            price: reqData.price_offer,
            location: reqData.location_offer,
            status: 'in_progress',
            urgency: 'Immediate',
            category: 'Direct'
        }])
        .select().single();

    await supabase.from('direct_requests').update({ status: 'converted' }).eq('id', id);
    res.json(task);
});

// ==========================================
// 5. REVIEWS, CHAT, STATUS
// ==========================================
app.post('/reviews', async (req, res) => {
    const { task_id, reviewer_id, reviewed_user_id, rating, comment } = req.body;
    await supabase.from('reviews').insert([{ task_id, reviewer_id, reviewed_user_id, rating, comment }]);
    
    const { data: reviews } = await supabase.from('reviews').select('rating').eq('reviewed_user_id', reviewed_user_id);
    const total = reviews.reduce((sum, r) => sum + r.rating, 0);
    const avg = total / reviews.length;
    await supabase.from('users').update({ rating_avg: avg }).eq('id', reviewed_user_id);
    
    res.json({ message: 'Review saved' });
});

app.post('/messages', async (req, res) => {
    const { task_id, sender_id, message_text } = req.body;
    const { data } = await supabase.from('messages').insert([{ task_id, sender_id, message_text }]).select();
    res.json(data);
});

app.get('/messages/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const { data } = await supabase.from('messages').select('*, users(name)').eq('task_id', taskId).order('created_at', { ascending: true });
    res.json(data);
});

app.put('/users/status', async (req, res) => {
    const { user_id, status } = req.body;
    await supabase.from('users').update({ status }).eq('id', user_id);
    res.json({ message: 'Status Updated' });
});

// Export for Vercel
module.exports = app;

if (require.main === module) {
    app.listen(3000, () => console.log('V5 Backend Running on Port 3000'));
}
