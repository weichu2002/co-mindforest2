// functions/collab.js - 适配阿里云ESA KV存储
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
      // 检查KV存储是否可用
      if (!env.COLLAB_KV) {
        console.log('KV存储环境变量:', Object.keys(env));
        return new Response(JSON.stringify({ 
          error: 'KV存储未配置，请检查环境变量设置',
          envKeys: Object.keys(env)
        }), {
          status: 500,
          headers: corsHeaders
        });
      }

      switch (action) {
        case 'create_room':
          return await handleCreateRoom(requestBody, env);
        case 'join_room':
          return await handleJoinRoom(requestBody, env);
        case 'leave_room':
          return await handleLeaveRoom(requestBody, env);
        case 'send_operation':
          return await handleSendOperation(requestBody, env);
        case 'get_updates':
          return await handleGetUpdates(url, env);
        case 'get_room_info':
          return await handleGetRoomInfo(url, env);
        case 'test_kv':
          return await handleTestKV(requestBody, env);
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

// 测试KV存储
async function handleTestKV(requestBody, env) {
  try {
    // 测试KV存储是否可访问
    const testKey = 'test:' + Date.now();
    const testValue = { timestamp: Date.now(), message: 'KV存储测试' };
    
    // 写入测试数据
    await env.COLLAB_KV.put(testKey, JSON.stringify(testValue));
    
    // 读取测试数据
    const readValue = await env.COLLAB_KV.get(testKey);
    
    // 删除测试数据
    await env.COLLAB_KV.delete(testKey);
    
    return new Response(JSON.stringify({
      success: true,
      message: 'KV存储测试成功',
      writeKey: testKey,
      writeValue: testValue,
      readValue: readValue ? JSON.parse(readValue) : null
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// 创建房间
async function handleCreateRoom(requestBody, env) {
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
    // 使用KV存储 - ESA KV存储的put方法
    await env.COLLAB_KV.put(roomKey, JSON.stringify(room));
    
    return new Response(JSON.stringify({
      success: true,
      roomId,
      message: '房间创建成功'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    console.error('创建房间KV存储错误:', error);
    return new Response(JSON.stringify({
      error: '创建房间失败: ' + error.message,
      details: '请检查KV存储配置'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// 加入房间
async function handleJoinRoom(requestBody, env) {
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
    const roomData = await env.COLLAB_KV.get(roomKey);
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
    await env.COLLAB_KV.put(roomKey, JSON.stringify(room));
    
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
async function handleLeaveRoom(requestBody, env) {
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
    const roomData = await env.COLLAB_KV.get(roomKey);
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
      await env.COLLAB_KV.delete(roomKey);
    } catch (error) {
      console.error('删除房间数据错误:', error);
    }
  } else {
    // 更新存储
    try {
      await env.COLLAB_KV.put(roomKey, JSON.stringify(room));
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
async function handleSendOperation(requestBody, env) {
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
    const roomData = await env.COLLAB_KV.get(roomKey);
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
  
  room.operations.push({
    ...operation,
    timestamp: Date.now(),
    userId,
    id: `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  });
  
  // 限制操作历史大小
  if (room.operations.length > 100) {
    room.operations = room.operations.slice(-50);
  }
  
  room.lastUpdated = Date.now();
  
  try {
    // 更新存储
    await env.COLLAB_KV.put(roomKey, JSON.stringify(room));
    
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
async function handleGetUpdates(url, env) {
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
    const roomData = await env.COLLAB_KV.get(roomKey);
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
async function handleGetRoomInfo(url, env) {
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
    const roomData = await env.COLLAB_KV.get(roomKey);
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
