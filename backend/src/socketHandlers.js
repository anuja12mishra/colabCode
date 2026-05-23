import axios from 'axios';
import {
  v4 as uuidv4
} from 'uuid';
import {
  roomManager
} from './roomManager.js';
import {
  JDOODLE_CLIENT_ID,
  JDOODLE_CLIENT_SECRET,
  JDOODLE_API_URL
} from './config.js';
import {
  getJDoodleParams
} from './languageMap.js';




/**
 * Cleans JDoodle output by extracting only the error message and line number.
 * If no error is detected, returns the original output.
 * @param {string} output - Raw output from JDoodle (stdout + stderr)
 * @returns {string} - Cleaned output
 */
function cleanJDoodleOutput(output) {
  // If output doesn't look like an error, return it as is
  if (!output || !output.includes('Error') && !output.includes('ReferenceError') &&
    !output.includes('SyntaxError') && !output.includes('TypeError') &&
    !output.includes('RangeError') && !output.includes('EvalError')) {
    return output;
  }

  // Split into lines
  const lines = output.split('\n');

  // Try to find a line that starts with an error type
  const errorPattern = /^(ReferenceError|SyntaxError|TypeError|RangeError|EvalError|Error):/;
  let errorLine = lines.find(line => errorPattern.test(line.trim()));

  // If no error line found, fallback to the first non‑empty line that might contain an error
  if (!errorLine) {
    errorLine = lines.find(line => line.trim().length > 0 &&
      (line.includes('Error') || line.includes('not defined') || line.includes('is not a function')));
  }

  // If we still have nothing, return the original output
  if (!errorLine) return output;

  // Try to extract line number from the stack trace (lines that contain a file path)
  const linePattern = /\(([^:]+):(\d+):(\d+)\)/;
  const stackLine = lines.find(line => linePattern.test(line));
  let lineNumber = '';
  if (stackLine) {
    const match = stackLine.match(linePattern);
    if (match && match[2]) {
      lineNumber = ` at line ${match[2]}`;
    }
  }

  // Build clean error message
  return `Error${lineNumber}: ${errorLine.trim()}`;
}

export default function registerSocketHandlers(io, socket) {
  let currentRoom = null;
  let currentUser = null;



  socket.on("join", async ({
    roomId,
    username
  }) => {
    if (currentRoom === roomId && currentUser === username) {
      return;
    }

    // Leave previous room if any
    if (currentRoom) {
      await handleLeave();
    }

    currentRoom = roomId;
    currentUser = username;
    socket.join(roomId);

    const roomData = await roomManager.getRoomData(roomId);
    io.to(roomId).emit("userJoined", roomData.users);
    console.log(`User ${username} connected socket to room ${roomId}`);
  });

  socket.on("leaveRoom", async () => {
    await handleLeave();
  });

  socket.on("userTyping", ({
    roomId,
    username
  }) => {
    socket.to(roomId).emit("userTyping", username);
  });

  socket.on("codeChange", async ({
    roomId,
    code
  }) => {
    await roomManager.setCode(roomId, code);
    socket.to(roomId).emit("codeUpdate", code);
  });

  socket.on("codeInputChange", async ({
    roomId,
    codeInput
  }) => {
    await roomManager.setInput(roomId, codeInput);
    io.to(roomId).emit("codeInputUpdate", codeInput);
  });

  socket.on("languageChange", async ({
    roomId,
    language
  }) => {
    await roomManager.setLanguage(roomId, language);
    io.to(roomId).emit("languageUpdate", language);
  });

  socket.on("compileCode", async ({
    code,
    roomId,
    language,
    codeinput
  }) => {
    if (roomManager.isExecuting(roomId)) {
      socket.emit("codeExecutionBusy", {
        message: 'Code execution in progress, please wait.'
      });
      return;
    }

    roomManager.setExecuting(roomId, true);
    io.to(roomId).emit("codeExecutionStarted");

    if (!(await roomManager.roomExists(roomId))) {
      socket.emit("codeResponse", {
        run: {
          output: "Error: Room does not exist."
        }
      });
      roomManager.setExecuting(roomId, false);
      io.to(roomId).emit("codeExecutionEnded");
      return;
    }

    try {
      const {
        language: jdoodleLang,
        versionIndex
      } = getJDoodleParams(language);

      const payload = {
        clientId: JDOODLE_CLIENT_ID,
        clientSecret: JDOODLE_CLIENT_SECRET,
        script: code,
        stdin: codeinput || "",
        language: jdoodleLang,
        versionIndex: versionIndex,
      };

      const response = await axios.post(JDOODLE_API_URL, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      let output = response.data.output;
      output = cleanJDoodleOutput(output); // <-- cleaning applied here

      await roomManager.setOutput(roomId, output);
      io.to(roomId).emit("codeResponse", {
        run: {
          output
        }
      });

    } catch (error) {
      console.error("JDoodle execution error:", error.response?.data || error.message);
      io.to(roomId).emit("codeResponse", {
        run: {
          output: "Error executing code: " + (error.response?.data?.error || "Unknown error")
        }
      });
    } finally {
      roomManager.setExecuting(roomId, false);
      io.to(roomId).emit("codeExecutionEnded");
    }
  });

  socket.on("disconnect", async () => {
    console.log("User disconnected", socket.id);
    await handleLeave();
  });

  async function handleLeave() {
    if (currentRoom && currentUser) {
      await roomManager.removeUser(currentRoom, currentUser);
      const users = await roomManager.getUsers(currentRoom);
      io.to(currentRoom).emit("userLeft", users);
      socket.leave(currentRoom);
      console.log(`User ${currentUser} left room ${currentRoom}`);
      currentRoom = null;
      currentUser = null;
    }
  }
}