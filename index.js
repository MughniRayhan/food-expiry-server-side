require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
    await client.connect();
    const foodCollection = client.db("foodExpiryDB").collection("food");

    // foods api
    app.get('/foods', async (req, res) => {
      const cursor = foodCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

     app.get('/foods/:id', async (req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await foodCollection.findOne(query);
      res.send(result);
    });

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


