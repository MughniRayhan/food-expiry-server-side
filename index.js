require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const axios = require('axios');
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
     
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.iuxl4dg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const db = client.db("foodExpiryDB");
    const foodCollection = db.collection("food");
    const usersCollection = db.collection("users");
    const recipesCollection = db.collection("recipes");

    // middleware to verify token
    const verifyFbToken = async(req,res,next)=>{
    const authHeaders = req.headers.authorization;
    if(!authHeaders){
      return res.status(401).send({message: "unauthorized access"})
    }

    const token = authHeaders.split(' ')[1];
    if(!token){
      return res.status(401).send({message: "unauthorized access"})
    }
      try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.decoded = decodedToken;
    next();
  } catch (error) {
    res.status(403).send({ message: "Forbidden access" });
  }
  }

  // varify admin role
  const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  if (!email) return res.status(401).send({ message: "Unauthorized" });

  try {
    const user = await usersCollection.findOne({ email });
    if(!user || user.role !== 'admin'){
      return res.status(403).send({message: "Forbidden accesss"})
    }
    next();
  } catch (error) {
    console.error("Error fetching user role:", error);
    res.status(500).send({ message: "Failed to fetch user role" });
  }
};

// Get all users (exclude current admin) or search by name/email
app.get('/users', verifyFbToken, verifyAdmin, async (req, res) => {
  try {
    const search = req.query.search?.trim();
    const currentAdminEmail = req.decoded?.email; // ✅ use decoded
    if (!currentAdminEmail) {
      return res.status(401).send({ message: "Unauthorized: no admin info" });
    }

    // Base query: exclude current admin
    let query = { email: { $ne: currentAdminEmail } };

    // Add search conditions if search exists
    if (search) {
      query.$or = [
        { displayName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ];
    }

    // Fetch users sorted by newest first
    const users = await usersCollection.find(query).sort({ _id: -1 }).toArray();

    res.send(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).send({ message: "Failed to fetch users" });
  }
});



// Ban / Unban user
app.patch('/users/:id/status', verifyFbToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'active' or 'banned'

  try {
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );
    res.json(result);
  } catch (error) {
    console.error("Error updating user status:", error);
    res.status(500).json({ message: "Failed to update user status" });
  }
});


// GET user role by email 
app.get('/users/role/:email', async (req, res) => {
  try {
    const { email } = req.params;
    if (!email) {
      return res.status(400).send({ message: "Email parameter is required" });
    }
    const user = await usersCollection.findOne(
      { email }
    );
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }
    res.send({ role: user.role || "user" }); 
  } catch (error) {
    console.error("Error fetching user role:", error);
    res.status(500).send({ message: "Failed to get user role" });
  }
});

// Save new user to DB if not exists
app.post("/users", async (req, res) => {
  try {
    const user = req.body;
    const existingUser = await usersCollection.findOne({ email: user.email });

    if (existingUser) {
      return res.send({ message: "User already exists", inserted: false });
    }

    const result = await usersCollection.insertOne(user);
    res.status(201).send({ message: "User created", inserted: true, result });
  } catch (error) {
    console.error("Error saving user:", error);
    res.status(500).send({ message: "Failed to save user" });
  }
});

app.patch("/users/:id", verifyFbToken,verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const { role } = req.body;
  const filter = { _id: new ObjectId(id) };
  const updateDoc = { $set: { role } };
  const result = await usersCollection.updateOne(filter, updateDoc);
  res.send(result);
});

// Update user profile (name, photo)
app.put('/users/profile/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { displayName, photoURL } = req.body;

    if (!email) return res.status(400).send({ message: "Email required" });

    const filter = { email };
    const updateDoc = {
      $set: {
        displayName,
        photoURL,
      },
    };

    const result = await usersCollection.updateOne(filter, updateDoc);
    res.status(200).send({ message: "Profile updated successfully", result });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).send({ message: "Failed to update profile" });
  }
});


   // foods api - show all foods sorted by addedDate (newest first)
app.get('/foods', async (req, res) => {
  try {
    const cursor = foodCollection.find().sort({ addedDate: -1 }); // newest first
    const result = await cursor.toArray();
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// search api - also sort by addedDate descending
app.get('/foods/search', async (req, res) => {
  const { q } = req.query;
  const query = q?.trim();

  try {
    let results;
    if (!query) {
      // if search input is empty, return all items sorted
      results = await foodCollection.find().sort({ addedDate: -1 }).toArray();
    } else {
      results = await foodCollection.find({
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { category: { $regex: query, $options: 'i' } }
        ]
      }).sort({ addedDate: -1 }).toArray();
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});


// food details
     app.get('/foods/:id', async (req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await foodCollection.findOne(query);
      res.send(result);
    });

  // update food
    app.put('/foods/:id', async(req,res) =>{
      const id = req.params.id;
      const filter = {_id: new ObjectId(id)};
      const updatedFood = req.body;
      const options = {upsert: true};
      const updateDoc = {
        $set: updatedFood
      }
      const result = await foodCollection.updateOne(filter, updateDoc, options);
      res.send(result);
    })
// delete
     app.delete('/foods/:id', async (req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await foodCollection.deleteOne(query);
      res.send(result);
    });

    // create new food
       app.post('/foods', async (req, res) => {
      const newFood = req.body;
      const result = await foodCollection.insertOne(newFood);
      res.send(result);
    });

// saving note
app.post('/foods/:id/notes', async (req, res) => {
  const foodId = req.params.id;
  const { note, email } = req.body;

  try {
    const food = await foodCollection.findOne({ _id: new ObjectId(foodId) });
    if (food.email !== email) {
      return res.status(403).json({ message: 'You are not allowed to add notes to this item.' });
    }
    const updateResult = await foodCollection.updateOne(
      { _id: new ObjectId(foodId) },
      { $push: { notes: note } }
    );

    if (updateResult.modifiedCount > 0) {
      res.status(200).json({ message: 'Note added successfully.' });
    } else {
      res.status(500).json({ message: 'Failed to add note.' });
    }

  } catch (error) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});


// sorted nearly expiry date
app.get('/nearly-expiry', async(req,res)=>{
 const today = new Date();
 const fiveDaysLater = new Date();
 fiveDaysLater.setDate(today.getDate() + 5);
 const result = await foodCollection.find({
  expirydate:{
    $gte: today.toISOString().split('T')[0],
    $lte: fiveDaysLater.toISOString().split('T')[0],
  }
 })
 .sort({expirydate:1}).toArray();
 res.send(result);
});
// wasted food (expired)
app.get('/wasted-food', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const result = await foodCollection.find({
      expirydate: { $lt: today }
    }).sort({ expirydate: -1 }).toArray();

    res.send(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch wasted food.' });
  }
});


// AI Tip Generator Endpoint
app.post("/ai-tip", async (req, res) => {
  const { foodName, expiryDate } = req.body;

  if (!foodName || !expiryDate) {
    return res.status(400).json({ message: "Food name and expiry date are required." });
  }

  // Helper function for retrying the request
  const fetchAiTip = async (retryCount = 2) => {
    try {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "openai/gpt-4o-mini:free",
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant that gives short, practical tips about food storage and reducing food waste.",
            },
            {
              role: "user",
              content: `Give a short one-line tip for keeping "${foodName}" fresh. It expires on ${expiryDate}.`,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 8000, // 8 seconds timeout
        }
      );

      return response.data?.choices?.[0]?.message?.content || null;
    } catch (error) {
      if (retryCount > 0) {
        console.warn(`⚠️ Retry left: ${retryCount} — Retrying AI tip fetch...`);
        return await fetchAiTip(retryCount - 1);
      } else {
        console.error("❌ AI Tip generation failed after retries:", error.message);
        return null;
      }
    }
  };

  const aiTip = await fetchAiTip();

  if (aiTip) {
    res.json({ tip: aiTip });
  } else {
    // Fallback tips when AI is unavailable
    const fallbackTips = [
      `Store "${foodName}" in an airtight container to extend freshness.`,
      `Keep "${foodName}" in a cool, dry place away from sunlight.`,
      `Check "${foodName}" regularly and use it before the expiry date.`,
      `Freeze "${foodName}" if you can’t use it soon.`,
      `Keep "${foodName}" sealed tightly to prevent moisture and odor absorption.`,
    ];
    const randomTip = fallbackTips[Math.floor(Math.random() * fallbackTips.length)];

    res.json({
      tip: randomTip,
      fallback: true,
      message: "AI service is currently unavailable. Showing a quick storage tip instead.",
    });
  }
});

// ------------------- AI Recipe Generator and Saver -------------------
app.post("/ai-recipe", async (req, res) => {
  const { ingredients, userEmail } = req.body;

  if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ message: "Ingredients array is required." });
  }

  if (!userEmail) {
    return res.status(400).json({ message: "User email required to save recipe." });
  }


  const ingredientList = ingredients.join(", ");

  const fetchAiRecipe = async (retryCount = 2) => {
    try {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are an expert chef AI. Respond only in valid JSON. Give short, clear, healthy recipe suggestions.",
            },
            {
              role: "user",
              content: `Generate a creative, easy recipe using these ingredients: ${ingredientList}. 
              Return JSON in format:
              {"title":"Recipe name","ingredients":["list"],"instructions":["step 1","step 2",...]}`,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      const raw = response.data?.choices?.[0]?.message?.content;
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      if (retryCount > 0) {
        console.warn(`Retrying AI recipe fetch (${retryCount} left)...`);
        return await fetchAiRecipe(retryCount - 1);
      } else {
        console.error("AI Recipe generation failed:", error.message);
        return null;
      }
    }
  };

  const aiRecipe = await fetchAiRecipe();

  if (aiRecipe) {
    const recipeData = {
      ...aiRecipe,
      ingredients,
      userEmail,
      createdAt: new Date(),
    };
    await recipesCollection.insertOne(recipeData);
    res.json({ ...aiRecipe, saved: true });
  } else {
    const fallback = {
      title: "Quick Vegetable Stir-Fry",
      ingredients,
      instructions: [
        "Chop all vegetables finely.",
        "Heat oil, sauté vegetables, and season with salt & pepper.",
        "Serve hot with rice or noodles.",
      ],
      fallback: true,
      message: "AI unavailable — showing fallback recipe.",
    };
    await recipesCollection.insertOne({
      ...fallback,
      userEmail,
      createdAt: new Date(),
    });
    res.json(fallback);
  }
});

// ------------------- Fetch All Saved Recipes -------------------
app.get("/recipes/:email", async (req, res) => {
  const { email } = req.params;
  const db = client.db("foodExpiryDB");
  const recipesCollection = db.collection("recipes");

  const recipes = await recipesCollection
    .find({ userEmail: email })
    .sort({ createdAt: -1 })
    .toArray();

  res.json(recipes);
});

// Notifications API
app.get("/notifications/:email", async (req, res) => {
  try {
    const { email } = req.params;

    // Today in YYYY-MM-DD format
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    // Five days later
    const fiveDaysLater = new Date();
    fiveDaysLater.setDate(today.getDate() + 5);
    const fiveDaysLaterStr = fiveDaysLater.toISOString().split("T")[0];

    // Find nearly expiring foods (within next 5 days)
    const nearlyExpiring = await foodCollection.find({
      email,
      expirydate: { $gte: todayStr, $lte: fiveDaysLaterStr },
    }).toArray();

    // Find wasted/expired foods
    const wastedFoods = await foodCollection.find({
      email,
      expirydate: { $lt: todayStr },
    }).toArray();

    // Find recent AI recipes
    const recentRecipes = await recipesCollection.find({ userEmail: email })
      .sort({ createdAt: -1 })
      .limit(3)
      .toArray();

    // Combine all notifications
    const notifications = [];

    nearlyExpiring.forEach(f => notifications.push({
      type: "warning",
      message: `"${f.title}" will expire on ${f.expirydate}`,
      date: f.expirydate,
    }));

    wastedFoods.forEach(f => notifications.push({
      type: "error",
      message: `"${f.title}" has expired on ${f.expirydate}`,
      date: f.expirydate,
    }));

    recentRecipes.forEach(r => notifications.push({
      type: "info",
      message: `New AI recipe added: "${r.title}"`,
      date: r.createdAt,
    }));

    // Sort notifications by date descending (most recent first)
    notifications.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(notifications);

  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
});



  } finally {
    
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Server of food expiry system  is ready!');
});

app.listen(port, () => {
  console.log(`Server of food expiry system is running on port ${port}`);
});