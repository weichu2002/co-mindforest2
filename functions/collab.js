// functions/collab.js - 适配阿里云ESA EdgeKV API
export default {
  async fetch(request, env, ctx) {
    // 设置CORS头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    const url = new URL(request.url);
    let action = url.searchParams.get('action');
    let requestBody = null;

    // 如果是POST请求，先读取并缓存请求体
    if (request.method === 'POST') {
      try {
        requestBody = await request.json();
        // 如果URL中没有action，尝试从请求体中获取
        if (!action && requestBody) {
          action = requestBody.action;
        }
      } catch (error) {
        console.error('解析请求体失败:', error);
        return new Response(JSON.stringify({ error: '无效的JSON格式' }), {
          status: 400,
          headers: corsHeaders
        });
      }
    }

    if (!action) {
      return new Response(JSON.stringify({ error: '缺少action参数' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    try {
      switch (action) {
        case 'create_room':
          return await handleCreateRoom(requestBody);
        case 'join_room':
          return await handleJoinRoom(requestBody);
        case 'leave_room':
          return await handleLeaveRoom(requestBody);
        case 'send_operation':
          return await handleSendOperation(requestBody);
        case 'get_updates':
          return await handleGetUpdates(url);
        case 'get_room_info':
          return await handleGetRoomInfo(url);
        default:
          return new Response(JSON.stringify({ error: '未知操作' }), {
            status: 400,
            headers: corsHeaders
          });
      }
    } catch (error) {
      console.error('协作API错误:', error);
      return new Response(JSON.stringify({
        error: error.message,
        code: "INTERNAL_ERROR"
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};

// ==================== ESA EdgeKV 工具函数 ====================

// 获取EdgeKV实例
function getEdgeKV(namespace) {
  // 根据官方文档，使用 new EdgeKV() 创建实例
  return new EdgeKV({ namespace: namespace || "mindforest-collab" });
}

// 从EdgeKV获取数据
async function edgeKVGet(namespace, key, type = "text") {
  try {
    const edgeKV = getEdgeKV(namespace);
    return await edgeKV.get(key, { type: type });
  } catch (error) {
    console.error(`EdgeKV get错误 (${namespace}/${key}):`, error);
    return undefined;
  }
}

// 向EdgeKV写入数据
async function edgeKVPut(namespace, key, value) {
  try {
    const edgeKV = getEdgeKV(namespace);
    await edgeKV.put(key, value);
    return true;
  } catch (error) {
    console.error(`EdgeKV put错误 (${namespace}/${key}):`, error);
    throw error;
  }
}

// 从EdgeKV删除数据
async function edgeKVDelete(namespace, key) {
  try {
    const edgeKV = getEdgeKV(namespace);
    const result = await edgeKV.delete(key);
    return result; // 返回true或false
  } catch (error) {
    console.error(`EdgeKV delete错误 (${namespace}/${key}):`, error);
    return false;
  }
}

// ==================== 协作API处理函数 ====================

// 创建房间
async function handleCreateRoom(requestBody) {
  if (!requestBody) {
    return new Response(JSON.stringify({ error: '请求体为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  const { roomId, roomData, snapshot, userId, userName } = requestBody;
  
  // 验证必要参数
  if (!roomId || !roomData || !userId) {
    return new Response(JSON.stringify({ error: '缺少必要参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  // 存储房间数据到KV
  const roomKey = `room:${roomId}`;
  const room = {
    ...roomData,
    snapshot: snapshot || {},
    operations: [],
    lastUpdated: Date.now()
  };
  
  try {
    // 使用EdgeKV存储 - 根据官方文档
    await edgeKVPut("mindforest-collab", roomKey, JSON.stringify(room));
    
    return new Response(JSON.stringify({
      success: true,
      roomId,
      message: '房间创建成功'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    console.error('创建房间EdgeKV存储错误:', error);
    return new Response(JSON.stringify({
      error: '创建房间失败: ' + error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// 加入房间
async function handleJoinRoom(requestBody) {
  if (!requestBody) {
    return new Response(JSON.stringify({ error: '请求体为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  const { roomId, userId, userName, userData } = requestBody;
  
  // 验证必要参数
  if (!roomId || !userId) {
    return new Response(JSON.stringify({ error: '缺少必要参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  let room;
  const roomKey = `room:${roomId}`;
  
  try {
    const roomData = await edgeKVGet("mindforest-collab", roomKey, "text");
    if (!roomData) {
      return new Response(JSON.stringify({ error: '房间不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    room = JSON.parse(roomData);
  } catch (error) {
    console.error('读取房间数据错误:', error);
    return new Response(JSON.stringify({ 
      error: '读取房间数据失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  // 添加用户到房间
  const existingUserIndex = room.activeUsers?.findIndex(u => u.id === userId);
  if (existingUserIndex === -1 || !room.activeUsers) {
    if (!room.activeUsers) room.activeUsers = [];
    const newUserData = userData || {
      id: userId,
      name: userName || `用户${userId.substring(0, 4)}`,
      color: Math.floor(Math.random() * 6),
      region: 'bj',
      joinedAt: new Date().toISOString(),
      isHost: false
    };
    room.activeUsers.push(newUserData);
  }
  
  room.lastUpdated = Date.now();
  
  try {
    // 更新存储
    await edgeKVPut("mindforest-collab", roomKey, JSON.stringify(room));
    
    return new Response(JSON.stringify({
      success: true,
      room: {
        id: room.id,
        name: room.name || '未命名房间',
        method: room.method || 'polling',
        createdBy: room.createdBy,
        createdByName: room.createdByName,
        activeUsers: room.activeUsers
      },
      snapshot: room.snapshot || {},
      message: '加入房间成功'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    console.error('更新房间数据错误:', error);
    return new Response(JSON.stringify({ 
      error: '更新房间数据失败: ' + error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// 离开房间
async function handleLeaveRoom(requestBody) {
  if (!requestBody) {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  const { roomId, userId } = requestBody;
  
  if (!roomId || !userId) {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  let room;
  const roomKey = `room:${roomId}`;
  
  try {
    const roomData = await edgeKVGet("mindforest-collab", roomKey, "text");
    if (!roomData) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    room = JSON.parse(roomData);
  } catch (error) {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  // 移除用户
  room.activeUsers = room.activeUsers?.filter(u => u.id !== userId) || [];
  room.lastUpdated = Date.now();
  
  // 如果房间为空，清理房间（可选）
  if (room.activeUsers.length === 0) {
    try {
      await edgeKVDelete("mindforest-collab", roomKey);
    } catch (error) {
      console.error('删除房间数据错误:', error);
    }
  } else {
    // 更新存储
    try {
      await edgeKVPut("mindforest-collab", roomKey, JSON.stringify(room));
    } catch (error) {
      console.error('更新房间数据错误:', error);
    }
  }
  
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// 发送操作
async function handleSendOperation(requestBody) {
  if (!requestBody) {
    return new Response(JSON.stringify({ error: '请求体为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  const { roomId, userId, operation } = requestBody;
  
  if (!roomId || !userId || !operation) {
    return new Response(JSON.stringify({ error: '缺少必要参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  let room;
  const roomKey = `room:${roomId}`;
  
  try {
    const roomData = await edgeKVGet("mindforest-collab", roomKey, "text");
    if (!roomData) {
      return new Response(JSON.stringify({ error: '房间不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    room = JSON.parse(roomData);
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: '读取房间数据失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  // 添加操作到历史
  if (!room.operations) {
    room.operations = [];
  }
  
  // 添加操作，包含完整信息
  room.operations.push({
    ...operation,
    timestamp: Date.now(),
    userId,
    userName: requestBody.userName || '用户', // 确保有用户名
    id: `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  });
  
  // 限制操作历史大小
  if (room.operations.length > 100) {
    room.operations = room.operations.slice(-50);
  }
  
  room.lastUpdated = Date.now();
  
  try {
    // 更新存储
    await edgeKVPut("mindforest-collab", roomKey, JSON.stringify(room));
    
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: '更新房间数据失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// 获取更新
async function handleGetUpdates(url) {
  const roomId = url.searchParams.get('roomId');
  const userId = url.searchParams.get('userId');
  const lastSync = parseInt(url.searchParams.get('lastSync') || '0');
  
  if (!roomId || !userId) {
    return new Response(JSON.stringify({ 
      error: '缺少必要参数',
      updates: [],
      users: [],
      lastSync: Date.now()
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  let room;
  const roomKey = `room:${roomId}`;
  
  try {
    const roomData = await edgeKVGet("mindforest-collab", roomKey, "text");
    if (!roomData) {
      return new Response(JSON.stringify({ 
        error: '房间不存在',
        updates: [],
        users: [],
        lastSync: Date.now()
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    room = JSON.parse(roomData);
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: '读取房间数据失败: ' + error.message,
      updates: [],
      users: [],
      lastSync: Date.now()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  // 获取上次同步后的新操作
  const updates = (room.operations || []).filter(op => 
    op.timestamp > lastSync && op.userId !== userId
  );
  
  return new Response(JSON.stringify({
    success: true,
    updates,
    users: room.activeUsers || [],
    lastSync: Date.now()
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// 获取房间信息
async function handleGetRoomInfo(url) {
  const roomId = url.searchParams.get('roomId');
  
  if (!roomId) {
    return new Response(JSON.stringify({ error: '缺少房间ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  let room;
  const roomKey = `room:${roomId}`;
  
  try {
    const roomData = await edgeKVGet("mindforest-collab", roomKey, "text");
    if (!roomData) {
      return new Response(JSON.stringify({ error: '房间不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    room = JSON.parse(roomData);
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: '读取房间数据失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  return new Response(JSON.stringify({
    success: true,
    room: {
      id: room.id,
      name: room.name || '未命名房间',
      method: room.method || 'polling',
      createdBy: room.createdBy,
      createdByName: room.createdByName,
      activeUsers: room.activeUsers || []
    },
    snapshot: room.snapshot || {}
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
