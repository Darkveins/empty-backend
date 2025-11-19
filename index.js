require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const COLLEGE_DOMAIN = '@gmail.com'; // Change to @college.edu for production

// Helper: Notification
async function createNotification(userId, title, message) {
    try {
        await supabase.from('notifications').insert([{ user_id: userId, title, message, is_read: false }]);
    } catch (e) { console.log(e); }
}

// 1. Auth & Verification
app.post('/login', async (req, res) => {
    const { phone, name, department, year, email } = req.body;
    let { data: user } = await supabase.from('users').select('*').eq('phone', phone).single();

    if (!user) {
        if (!email) return res.status(400).json({ error: "College Email required." });
        if (!email.toLowerCase().endsWith(COLLEGE_DOMAIN)) return res.status(400).json({ error: "Invalid Domain." });

        const { data: newUser, error } = await supabase.from('users').insert([{ 
            name, phone, department, year, email, status: 'available', is_verified: true, rating_avg: 5.0 
        }]).select().single();
        if (error) return res.status(400).json({ error: error.message });
        user = newUser;
    }
    res.json(user);
});

// 2. Tasks
app.get('/tasks', async (req, res) => {
    const { category } = req.query;
    let query = supabase.from('tasks').select('*, users!created_by(name, department, rating_avg, is_verified)').eq('status', 'open').order('created_at', { ascending: false });
    if (category && category !== 'All') query = query.eq('category', category);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

app.post('/tasks', async (req, res) => {
    const { created_by, title, description, price, location, urgency, category } = req.body;
    const { data, error } = await supabase.from('tasks').insert([{ 
        created_by, title, description, price, location, urgency, category: category || 'General', status: 'open' 
    }]).select();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

app.put('/tasks/:taskId/complete', async (req, res) => {
    const { taskId } = req.params;
    const { data: task, error } = await supabase.from('tasks').update({ status: 'completed' }).eq('id', taskId).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await createNotification(task.created_by, "Task Completed", `Task "${task.title}" is done.`);
    res.json({ message: 'Done' });
});

// 3. Helpers & Requests
app.get('/search/helpers', async (req, res) => {
    const { skill, query } = req.query;
    let dbQuery = supabase.from('users').select('*').eq('status', 'available').order('rating_avg', { ascending: false });
    if (skill && skill !== 'All') dbQuery = dbQuery.contains('skills', [skill]);
    if (query) dbQuery = dbQuery.ilike('name', `%${query}%`);
    const { data } = await dbQuery;
    res.json(data || []);
});

app.get('/helpers', async (req, res) => {
    const { data } = await supabase.from('users').select('id, name, rating_avg, status').eq('status', 'available').order('rating_avg', { ascending: false }).limit(10);
    res.json(data || []);
});

app.post('/direct-requests', async (req, res) => {
    const { sender_id, receiver_id, message, price, location } = req.body;
    const { data, error } = await supabase.from('direct_requests').insert([{ sender_id, receiver_id, message, price_offer: price, location_offer: location, status: 'pending' }]).select();
    if (error) return res.status(400).json({ error: error.message });
    await createNotification(receiver_id, "New Job Request", `Offer: ₹${price}`);
    res.json(data);
});

// 4. Notifications, Chat, Reviews
app.get('/notifications/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    res.json(data);
});
app.put('/notifications/:id/read', async (req, res) => {
    const { id } = req.params;
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    res.json({ success: true });
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

module.exports = app;