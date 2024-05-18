const express = require('express');
const app = express();
require('dotenv').config();
const port = process.env.PORT || 5000;
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@prakarsa-hijau.koqsddm.mongodb.net/?retryWrites=true&w=majority&appName=prakarsa-hijau`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Middleware to verify token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

async function run() {
  try {
    // Connect the client to the server
    await client.connect();

    // Create a database and collections
    const database = client.db("prakarsa-hijau");
    const usersCollection = database.collection("users");
    const tipsCollection = database.collection("tips");
    const commentsCollection = database.collection("comments");

    // Endpoint to register a new user
    app.post('/register', async (req, res) => {
      const { name, email, password, avatar } = req.body;

      // Validate input
      if (!name || !email || !password) {
        return res.status(400).json({
          status: "fail",
          message: "Name, email, and password are required"
        });
      }

      try {
        // Check if the user already exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(400).json({
            status: "fail",
            message: "Email already in use"
          });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create the new user
        const newUser = {
          name,
          email,
          password: hashedPassword,
          avatar: avatar || 'https://default-avatar-url.jpg',
          createdAt: new Date().toISOString()
        };

        // Insert the new user into the database
        const result = await usersCollection.insertOne(newUser);

        // Generate JWT token
        const accessToken = jwt.sign({ id: result.insertedId, email: newUser.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // Return the newly created user and token (without the password)
        res.status(201).json({
          status: "success",
          message: "User registered",
          data: {
            user: {
              id: result.insertedId,
              name: newUser.name,
              email: newUser.email,
              avatar: newUser.avatar,
              createdAt: newUser.createdAt
            },
            token: accessToken
          }
        });
      } catch (error) {
        console.error(`Error registering user: ${error.message}`);
        res.status(500).json({
          status: "error",
          message: "An error occurred while registering the user",
          error: error.message
        });
      }
    });

    // Endpoint to login a user
    app.post('/login', async (req, res) => {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return res.status(400).json({
          status: "fail",
          message: "Email and password are required"
        });
      }

      try {
        // Check if the user exists
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(400).json({
            status: "fail",
            message: "Invalid email or password"
          });
        }

        // Compare the password with the hashed password
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
          return res.status(400).json({
            status: "fail",
            message: "Invalid email or password"
          });
        }

        // Generate JWT token
        const accessToken = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // Return the token
        res.status(200).json({
          status: "success",
          message: "User logged in",
          data: {
            token: accessToken
          }
        });
      } catch (error) {
        console.error(`Error logging in user: ${error.message}`);
        res.status(500).json({
          status: "error",
          message: "An error occurred while logging in the user",
          error: error.message
        });
      }
    });

    // Endpoint to add new tips (protected)
    app.post('/add-tips', authenticateToken, async (req, res) => {
      const newTips = req.body;
      const result = await tipsCollection.insertOne(newTips);
      res.send(result);
    });

    // Endpoint to get all tips (protected)
    app.get('/tips', authenticateToken, async (req, res) => {
      const result = await tipsCollection.find().toArray();
      res.send(result);
    });

    // Endpoint to get a tip by ID with detailed information (protected)
    app.get('/tips/:tipId', authenticateToken, async (req, res) => {
      const { tipId } = req.params;
      try {
        // Ensure the tipId is a valid ObjectId
        const objectId = new ObjectId(tipId);
        const tip = await tipsCollection.findOne({ _id: objectId });

        if (tip) {
          // Get the owner information
          const owner = await usersCollection.findOne({ _id: new ObjectId(tip.ownerId) });

          if (!owner) {
            console.error(`Owner not found for tip with ID ${tipId} and ownerId ${tip.ownerId}`);
            return res.status(404).json({
              status: "fail",
              message: "Owner not found"
            });
          }

          // Get the comments for this tip
          const comments = await commentsCollection.find({ tipId: tip.id }).toArray();

          // Enrich comments with user information
          const detailedComments = await Promise.all(comments.map(async (comment) => {
            const commentOwner = await usersCollection.findOne({ _id: new ObjectId(comment.ownerId) });

            if (!commentOwner) {
              console.error(`Comment owner not found for comment with ID ${comment._id} and ownerId ${comment.ownerId}`);
              return {
                id: comment._id.toString(),
                content: comment.content,
                createdAt: comment.createdAt,
                owner: {
                  id: null,
                  name: "Unknown",
                  avatar: ""
                },
                upVotesBy: comment.upVotesBy,
                downVotesBy: comment.downVotesBy
              };
            }

            return {
              id: comment._id.toString(),
              content: comment.content,
              createdAt: comment.createdAt,
              owner: {
                id: commentOwner._id.toString(),
                name: commentOwner.name,
                avatar: commentOwner.avatar
              },
              upVotesBy: comment.upVotesBy,
              downVotesBy: comment.downVotesBy
            };
          }));

          // Construct the detailed tip
          const detailedTip = {
            id: tip._id.toString(),
            title: tip.title,
            body: tip.body,
            category: tip.category,
            createdAt: tip.createdAt,
            owner: {
              id: owner._id.toString(),
              name: owner.name,
              avatar: owner.avatar
            },
            upVotesBy: tip.upVotesBy,
            downVotesBy: tip.downVotesBy,
            comments: detailedComments
          };

          res.json({
            status: "success",
            message: "Tip retrieved",
            data: {
              detailTip: detailedTip
            }
          });
        } else {
          console.error(`Tip not found with ID ${tipId}`);
          res.status(404).json({
            status: "fail",
            message: "Tip not found"
          });
        }
      } catch (error) {
        console.error(`Error retrieving tip with ID ${tipId}: ${error.message}`);
        res.status(500).json({
          status: "error",
          message: "An error occurred while retrieving the tip",
          error: error.message
        });
      }
    });

    // Endpoint to get all users (protected)
app.get('/users', async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();

    // Return the users information (without the password and createdAt)
    const sanitizedUsers = users.map(user => ({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      avatar: user.avatar
    }));

    res.json({
      status: "success",
      message: "ok",
      data: {
        users: sanitizedUsers
      }
    });
  } catch (error) {
    console.error(`Error retrieving users: ${error.message}`);
    res.status(500).json({
      status: "error",
      message: "An error occurred while retrieving users",
      error: error.message
    });
  }
});

    // Endpoint to get a user by ID
    app.get('/users/:userId', authenticateToken, async (req, res) => {
      const { userId } = req.params;
      try {
        // Ensure the userId is a valid ObjectId
        const objectId = new ObjectId(userId);
        const user = await usersCollection.findOne({ _id: objectId });

        if (user) {
          // Return the user information (without the password)
          res.json({
            status: "success",
            message: "User retrieved",
            data: {
              user: {
                id: user._id.toString(),
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                createdAt: user.createdAt
              }
            }
          });
        } else {
          console.error(`User not found with ID ${userId}`);
          res.status(404).json({
            status: "fail",
            message: "User not found"
          });
        }
      } catch (error) {
        console.error(`Error retrieving user with ID ${userId}: ${error.message}`);
        res.status(500).json({
          status: "error",
          message: "An error occurred while retrieving the user",
          error: error.message
        });
      }
    });

    // Endpoint to get the current logged-in user's data (protected)
    app.get('/users/me', authenticateToken, async (req, res) => {
      try {
        const userId = req.user.id; // The user ID is stored in the token

        const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

        if (!user) {
          return res.status(404).json({
            status: "fail",
            message: "User not found"
          });
        }

        // Return the user information (without the password)
        const sanitizedUser = {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          avatar: user.avatar
        };

        res.json({
          status: "success",
          message: "ok",
          data: {
            user: sanitizedUser
          }
        });
      } catch (error) {
        console.error(`Error retrieving user data: ${error.message}`);
        res.status(500).json({
          status: "error",
          message: "An error occurred while retrieving user data",
          error: error.message
        });
      }
    });

    //Login
    app.post('/login', async (req, res) => {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          status: "fail",
          message: "Email and password are required"
        });
      }

      try {
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(400).json({
            status: "fail",
            message: "Invalid email or password"
          });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
          return res.status(400).json({
            status: "fail",
            message: "Invalid email or password"
          });
        }

        const accessToken = jwt.sign(
          {
            id: user._id.toString(),
            name: user.name,
            avatar: user.avatar
          },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        res.status(200).json({
          status: "success",
          message: "ok",
          data: {
            token: accessToken
          }
        });
      } catch (error) {
        console.error(`Error logging in user: ${error.message}`);
        res.status(500).json({
          status: "error",
          message: "An error occurred while logging in the user",
          error: error.message
        });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello Asandy!')
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
