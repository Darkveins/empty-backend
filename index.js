require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Connect to Supabase Database
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ==========================================
// CONFIGURATION
// ==========================================
// REPLACE this with your actual college domain
const COLLEGE_DOMAIN = '@kpriet.ac.in'; 

// ==========================================
// API ENDPOINTS
// ==========================================

// 1. LOGIN / REGISTER (With Student Verification)
app.post('/login', async (req, res) => {
    const { phone, name, department, year, email } = req.body;
    
    // Step A: Check if user already exists
    let { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('phone', phone)
        .single();

    // Step B: If user does NOT exist, Register them
    if (!user) {
        // --- SECURITY CHECK START ---
        if (!email) {
            return res.status(400).json({ error: "College Email is required for new registration." });
        }

        // Verify domain matches the college rules
        if (!email.toLowerCase().endsWith(COLLEGE_DOMAIN)) {
            return res.status(400).json({ 
                error: `Access Denied. You must use an official ${COLLEGE_DOMAIN} email ID.` 
            });
        }
        // --- SECURITY CHECK END ---

        // Create the user
        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert([{ 
                name, 
                phone, 
                department, 
                year, 
                email, 
                status: 'available' 
            }])
            .select()
            .single();
            
        if (createError) return res.status(400).json({ error: createError.message });
        user = newUser;
    }

    res.json(user);
});

// 2. FETCH TASK FEED
app.get('/tasks', async (req, res) => {
    const { data: tasks, error } = await supabase
        .from('tasks')
        .select(`
            *,
            users (name, department, status)
        `)
        .eq('status', 'open')
        .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json(tasks);
});

// 3. POST A NEW TASK
app.post('/tasks', async (req, res) => {
    const { created_by, title, description, price, location, urgency } = req.body;

    const { data, error } = await supabase
        .from('tasks')
        .insert([{ 
            created_by, 
            title, 
            description, 
            price, 
            location, 
            urgency,
            status: 'open' 
        }])
        .select();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

// 4. UPDATE USER STATUS
app.put('/users/status', async (req, res) => {
    const { user_id, status } = req.body;
    
    const validStatuses = ['available', 'busy', 'not_taking_tasks', 'offline'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status for V1" });
    }

    const { data, error } = await supabase
        .from('users')
        .update({ status })
        .eq('id', user_id)
        .select();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

// 5. SEND MESSAGE (CHAT)
app.post('/messages', async (req, res) => {
    const { task_id, sender_id, message_text } = req.body;
    
    const { data, error } = await supabase
        .from('messages')
        .insert([{ task_id, sender_id, message_text }])
        .select();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

// 6. GET MESSAGES (CHAT HISTORY)
app.get('/messages/:taskId', async (req, res) => {
    const { taskId } = req.params;
    
    const { data, error } = await supabase
        .from('messages')
        .select(`
            *,
            users (name)
        `)
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

// 7. MARK TASK AS COMPLETED
app.put('/tasks/:taskId/complete', async (req, res) => {
    const { taskId } = req.params;
    
    const { data, error } = await supabase
        .from('tasks')
        .update({ status: 'completed' })
        .eq('id', taskId)
        .select();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: "Task completed successfully", task: data });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Empty App Backend running on port ${PORT}`);
});