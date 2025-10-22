require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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

// Get all users or search by name/email
app.get('/users', verifyFbToken, verifyAdmin, async (req, res) => {
  const search = req.query.search;
  let query = {};

  if (search) {
    query = {
      $or: [
        { displayName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ]
    };
  }

  try {
    const users = await usersCollection.find(query).toArray();
    res.send(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).send({ message: "Failed to fetch users" });
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


    // foods api
    app.get('/foods', async (req, res) => {
      const cursor = foodCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // search
    app.get('/foods/search', async (req, res) => {
  const { q } = req.query;
  const query = q?.trim();

  if (!query) {
    return res.status(400).json({ error: 'Search query required' });
  }
  try {
    const results = await foodCollection.find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { category: { $regex: query, $options: 'i' } }
      ]
    }).toArray();

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