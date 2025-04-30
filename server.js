const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const morgan = require('morgan');
const Notification = require("./models/Notification"); // ✅ Import Notification Model
const User = require("./models/User"); // ✅ Import User Model
const authRoutes = require("./routes/authRoutes");
const postRoutes = require("./routes/postRoutes");
const userRoutes = require("./routes/userRoutes");
const storyRoutes = require("./routes/storyRoutes");
const conversationsRoutes = require('./routes/conversations');
const messagesRoutes = require('./routes/messages');
const profileRoutes = require('./routes/profileRoutes');
const notificationRoutes = require("./routes/notificationRoutes");
const uploadRoutes = require('./routes/uploads');
const reelRoutes = require('./routes/reelRoutes');
dotenv.config();

const app = express();
const server = http.createServer(app);
app.use(morgan('dev'));

// ✅ CORS middleware for Express
// app.use(cors({
//   origin: ["https://social-frontend-five.vercel.app","http://localhost:3000/"],
//   credentials: true
// }));


const allowedOrigins = [
  'http://localhost:3000',
  'https://social-frontend-five.vercel.app',
  'https://vizzf.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));


app.use(express.json());

// ✅ API Routes
app.use("/api/auth", authRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/users", userRoutes);
app.use("/api/stories", storyRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/profile', profileRoutes);
app.use("/api/notifications", notificationRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/reels', reelRoutes);

// ✅ Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// app.use('/uploads', express.static('uploads'));

app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // or set allowed frontend domain
  next();
}, express.static(path.join(__dirname, 'uploads')));

// ✅ Set up Socket.IO with CORS
// const io = socketIo(server, {
//   cors: {
//     origin: ["https://social-frontend-five.vercel.app","http://localhost:3001/"],
//     methods: ["GET", "POST"],
//     allowedHeaders: ["Content-Type"],
//     credentials: true
//   }
// });

const io = socketIo(server, {
  cors: {
    origin: ["https://social-frontend-five.vercel.app", "http://localhost:3000"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization", "x-auth-token"],
    credentials: true
  }
});



// ✅ Store online users in a Map
const onlineUsers = new Map();

// ✅ Function to Send Notifications - Defined outside so it's accessible throughout the app
// ✅ Function to Send Notifications - Defined outside so it's accessible throughout the app
const sendNotification = async (receiverId, senderId, message, senderPic, type, postId = null, commentId = null) => {
  try {
    // Check for existing similar notification in the last 2 minutes to prevent duplicates
    const existingNotification = await Notification.findOne({
      userId: receiverId,
      senderId: senderId,
      type: type,
      message: message,
      createdAt: { $gt: new Date(Date.now() - 2 * 60 * 1000) } // Within last 2 minutes
    });

    if (existingNotification) {
      console.log("Duplicate notification prevented");
      return;
    }

    // Create and save the notification
    const notification = new Notification({ 
      userId: receiverId, 
      senderId, 
      message, 
      type,
      senderPic,
      postId,
      commentId
    });
    await notification.save();

    // Fetch sender information to include in notification
    const sender = await User.findById(senderId).select("username profilePic");

    // Format notification with sender details for frontend
    if (onlineUsers.has(receiverId)) {
      const notificationObj = {
        _id: notification._id,
        userId: notification.userId,
        senderId: { 
          _id: senderId,
          username: sender ? sender.username : "User",
          profilePic: sender ? sender.profilePic : senderPic
        },
        message: message,
        type: type,
        postId: postId,
        commentId: commentId,
        createdAt: notification.createdAt
      };
      
      // Emit to specific user
      io.to(receiverId).emit("newNotification", notificationObj);
      console.log(`Notification sent to user ${receiverId}`);
    } else {
      console.log(`User ${receiverId} is offline, notification saved to database only`);
    }

    return notification;
  } catch (error) {
    console.error("Error sending notification:", error);
  }
};

// ✅ Store `sendNotification` in Express `app` so it's available in routes
app.set("sendNotification", sendNotification);

// ✅ Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // Ping-pong to keep connection alive
  const pingInterval = setInterval(() => {
    socket.emit("ping");
  }, 25000);

  socket.on("pong", () => {
    console.log(`Received pong from ${socket.id}`);
  });

  // ✅ Join a room for a post
  socket.on("joinPost", (postId) => {
    socket.join(`post:${postId}`);
    console.log(`Socket ${socket.id} joined post:${postId}`);
  });

  // ✅ Leave a post room
  socket.on("leavePost", (postId) => {
    socket.leave(`post:${postId}`);
    console.log(`Socket ${socket.id} left post:${postId}`);
  });

  // ✅ Join a conversation room
  socket.on("joinConversation", (conversationId) => {
    socket.join(conversationId);
    console.log(`Socket ${socket.id} joined conversation: ${conversationId}`);
  });

  // ✅ Leave a conversation room
  socket.on("leaveConversation", (conversationId) => {
    socket.leave(conversationId);
    console.log(`Socket ${socket.id} left conversation: ${conversationId}`);
  });

  // ✅ User joins for notifications
  socket.on("joinUser", (userId) => {
    if (userId) {
      socket.join(userId);
      onlineUsers.set(userId, socket.id);
      console.log(`User ${userId} joined notifications with socket ${socket.id}`);
    } else {
      console.log("Invalid userId for joinUser event");
    }
  });

   // Call handlers
   socket.on('startCall', ({ conversationId, caller, type }) => {
    socket.to(conversationId).emit('incomingCall', { caller, type });
  });
  
  socket.on('acceptCall', ({ conversationId }) => {
    socket.to(conversationId).emit('callAccepted');
  });
  
  socket.on('rejectCall', ({ conversationId }) => {
    socket.to(conversationId).emit('callRejected');
  });
  
  socket.on('endCall', ({ conversationId }) => {
    socket.to(conversationId).emit('callEnded');
  });
  // ✅ Handle reconnection
  socket.on("reconnect", (userId) => {
    if (userId) {
      socket.join(userId);
      onlineUsers.set(userId, socket.id);
      console.log(`User ${userId} reconnected with socket ${socket.id}`);
    }
  });

  // ✅ Handle disconnect
  socket.on("disconnect", () => {
    clearInterval(pingInterval);
    console.log(`Client disconnected: ${socket.id}`);

    // ✅ Remove disconnected user from `onlineUsers`
    onlineUsers.forEach((value, key) => {
      if (value === socket.id) {
        onlineUsers.delete(key);
        console.log(`User ${key} removed from online users`);
      }
    });
  });
});

// ✅ Make `io` accessible to your routes
app.set("io", io);







app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src *; script-src * 'unsafe-inline'; style-src * 'unsafe-inline'; object-src *");
  next();
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));