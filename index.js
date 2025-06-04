require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Server of food expiry system  is ready!');
});

app.listen(port, () => {
  console.log(`Server of food expiry system is running on port ${port}`);
});
