import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { roomManager } from './roomManager.js';

const router = express.Router();

router.get("/user-exists", async (req, res) => {
  const { username, roomId } = req.query;
  const exists = await roomManager.userExists(roomId, username);
  res.json({ exists });
});

router.post("/create-room", async (req, res) => {
  try {
    const newRoomId = uuidv4();
    await roomManager.createRoom(newRoomId);
    res.json({ roomId: newRoomId });
  } catch (error) {
    console.error("Error creating room:", error);
    res.status(500).json({ error: "Failed to create room" });
  }
});

router.post("/join-room", async (req, res) => {
  const { roomId, username } = req.body;
  try {
    const exists = await roomManager.roomExists(roomId);
    if (!exists) {
      return res.status(404).json({ error: "Room not found" });
    }
    
    const added = await roomManager.addUser(roomId, username);
    if (!added) {
      return res.status(400).json({ error: "Username already in use in this room. Please choose a different name." });
    }
    
    const roomData = await roomManager.getRoomData(roomId);
    res.json({ roomData });
  } catch (error) {
    console.error("Error joining room:", error);
    res.status(500).json({ error: "Failed to join room" });
  }
});


// Alias for backward compatibility
router.get("/user-exit", async (req, res) => {
  const { username, roomId } = req.query;
  const exists = await roomManager.userExists(roomId, username);
  res.json({ exists });
});

router.get("/room-exists", async (req, res) => {
  const { roomId } = req.query;
  const exists = await roomManager.roomExists(roomId);
  res.json({ exists });
});

router.get("/room-info", async (req, res) => {
  const { roomId } = req.query;
  if (!(await roomManager.roomExists(roomId))) {
    return res.status(404).json({ error: "Room not found" });
  }
  const data = await roomManager.getRoomData(roomId);
  res.json({
    roomId,
    userCount: data.users.length,
    language: data.language,
    users: data.users,
  });
});

router.get("/health", async (req, res) => {
  res.json({
    status: "OK",
    activeRooms: await roomManager.getActiveRoomsCount(),
    timestamp: new Date().toISOString(),
  });
});

export default router;