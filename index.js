const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
require('dotenv').config();

// Bot configuration
const token = process.env.BOT_TOKEN;
const secToken = process.env.BOT_SECOND_TOKEN
const adminId = process.env.ADMIN_ID
const bot = new TelegramBot(token, { polling: true });
const bot2 = new TelegramBot(secToken, { polling: true });

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Initialize database tables
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        balance NUMERIC DEFAULT 0,
        referrer_id BIGINT,
        join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS stats (
        id SERIAL PRIMARY KEY,
        total_users INTEGER DEFAULT 0,
        today_users INTEGER DEFAULT 0,
        total_paid NUMERIC DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS payment_requests (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        amount NUMERIC,
        status TEXT DEFAULT 'pending',
        request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );
      
      CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL
      );
    `);
    
    // Initialize stats if not exists
    const statsCheck = await pool.query('SELECT * FROM stats');
    if (statsCheck.rows.length === 0) {
      await pool.query('INSERT INTO stats DEFAULT VALUES');
    }
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Required channels to subscribe
const requiredChannels = [
  { id: '@refproverk', name: 'Канал 1', url: 'https://t.me/refproverk' },
  { id: '@refproverk', name: 'Канал 2', url: 'https://t.me/refproverk' },
];

// Main menu inline keyboard
const mainMenuKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '💻 Профиль', callback_data: 'profile' },
        { text: '📈 Статистика', callback_data: 'statistics' }
      ],
      [{ text: '🔧 Функционал', callback_data: 'functionality' }]
    ]
  }
};

// Functionality menu inline keyboard
const functionalityKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📚 Мануалы', callback_data: 'manuals' }],
      [{ text: '⭐ Отзывы', callback_data: 'reviews' }],
      [{ text: '❗ Обязательные подписки', callback_data: 'required_subscriptions' }],
      [{ text: '💰 Выплаты', callback_data: 'payments' }],
      [{ text: '❓ По всем вопросам', url: 'https://t.me/Mr_SnAyPeR' }],
      [{ text: '👥 Рефералы', callback_data: 'referrals' }],
      [{ text: '🔙 Назад в меню', callback_data: 'back_to_main' }]
    ]
  }
};

// Back button
const backButton = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
    ]
  }
};

// Check if user is registered
async function isUserRegistered(userId) {
  const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return result.rows.length > 0;
}

// Register new user
async function registerUser(userId, username, referrerId = null) {
  try {
    await pool.query(
      'INSERT INTO users (user_id, username, referrer_id) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
      [userId, username, referrerId]
    );
    
    // Update stats
    await pool.query('UPDATE stats SET total_users = total_users + 1, today_users = today_users + 1');
    
    // Add bonus to referrer if exists
    if (referrerId) {
      await pool.query('UPDATE users SET balance = balance + 0.5 WHERE user_id = $1', [referrerId]);
    }
  } catch (error) {
    console.error('Error registering user:', error);
  }
}

// Check subscriptions to required channels
async function checkSubscriptions(userId) {
  for (const channel of requiredChannels) {
    try {
      const chatMember = await bot.getChatMember(channel.id, userId);
      if (chatMember.status === 'left' || chatMember.status === 'kicked' || chatMember.status === 'banned') {
        return false;
      }
    } catch (error) {
      console.error(`Error checking subscription for channel ${channel.id}:`, error.message);
      return false;
    }
  }
  return true;
}

// Get user profile
async function getUserProfile(userId) {
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return null;
    }
    
    const user = userResult.rows[0];
    
    // Count referrals
    const referralsResult = await pool.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [userId]);
    const referralsCount = parseInt(referralsResult.rows[0].count);
    
    return {
      userId: user.user_id,
      username: user.username,
      balance: parseFloat(user.balance),
      referralsCount,
      referrerId: user.referrer_id
    };
  } catch (error) {
    console.error('Error getting user profile:', error);
    return null;
  }
}

// Get referral info
async function getReferralInfo(userId) {
  try {
    // Count all referrals
    const referralsResult = await pool.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [userId]);
    const referralsCount = parseInt(referralsResult.rows[0].count);
    
    // Calculate earnings from referrals
    const earningsResult = await pool.query(`
      SELECT SUM(balance) as total_earnings
      FROM users
      WHERE referrer_id = $1
    `, [userId]);
    
    const totalEarnings = parseFloat(earningsResult.rows[0].total_earnings || 0);
    
    return {
      referralsCount,
      totalEarnings
    };
  } catch (error) {
    console.error('Error getting referral info:', error);
    return { referralsCount: 0, totalEarnings: 0 };
  }
}

// Get bot statistics
async function getBotStats() {
  try {
    const statsResult = await pool.query('SELECT * FROM stats');
    return statsResult.rows[0];
  } catch (error) {
    console.error('Error getting bot stats:', error);
    return null;
  }
}

// Admin commands to manage users
async function resetUserReferrals(userId) {
  try {
    await pool.query('UPDATE users SET referrer_id = NULL WHERE referrer_id = $1', [userId]);
    return true;
  } catch (error) {
    console.error('Error resetting user referrals:', error);
    return false;
  }
}

async function resetUserBalance(userId) {
  try {
    await pool.query('UPDATE users SET balance = 0 WHERE user_id = $1', [userId]);
    return true;
  } catch (error) {
    console.error('Error resetting user balance:', error);
    return false;
  }
}

// Generate subscription buttons
function getSubscriptionButtons() {
  return {
    reply_markup: {
      inline_keyboard: [
        ...requiredChannels.map(channel => [{ text: `📢 Подписаться на ${channel.name}`, url: channel.url }]),
        [{ text: '🔄 Проверить подписки', callback_data: 'check_subs' }]
      ]
    }
  };
}

// Handle start command
bot.onText(/\/start(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || 'NoUsername';
  const referrerId = match && match[1] ? parseInt(match[1]) : null;
  
  const isRegistered = await isUserRegistered(userId);
  
  if (!isRegistered) {
    await registerUser(userId, username, referrerId);
  }
  
  // Приветственное сообщение
  await bot.sendPhoto(chatId, './image.png', {
    caption: '👋 Добро пожаловать в 𝐆𝐀𝐋𝐀𝐗𝐘 𝐓𝐑𝐀𝐅𝐅𝐈𝐂 | 𝐓𝐄𝐀𝐌!\n\n⚠️ Для использования бота необходимо подписаться на следующие каналы:',
    parse_mode: 'HTML',
    ...getSubscriptionButtons()
  });
});

// Callback query handler
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  
  // Check subscription callback
  if (data === 'check_subs') {
    const subscribed = await checkSubscriptions(userId);
    
    if (subscribed) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Все подписки активны! ✅' });
      
      const profile = await getUserProfile(userId);
      let referrerMessage = '';
      
      if (profile && profile.referrerId) {
        referrerMessage = `\n\n👥 Вы были приглашены пользователем ID: ${profile.referrerId}!`;
      }
      
      try {
        // Отправляем основное меню с изображением
        await bot.sendPhoto(chatId, './image.png', {
          caption: `✅ Спасибо за подписку! Теперь вы можете использовать все функции бота.${referrerMessage}\n\nВыберите нужный раздел в меню ниже:`,
          ...mainMenuKeyboard
        });
      } catch (error) {
        console.error('Error sending photo:', error);
        await bot.sendMessage(chatId, 
          `✅ Спасибо за подписку! Теперь вы можете использовать все функции бота.${referrerMessage}\n\nВыберите нужный раздел в меню ниже:`,
          mainMenuKeyboard
        );
      }
    } else {
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Вы подписаны не на все каналы! ❌' });
      
      await bot.sendMessage(chatId, 
        `⚠️ Пожалуйста, подпишитесь на все необходимые каналы для продолжения:`,
        getSubscriptionButtons()
      );
    }
    return;
  }
  
  // Check if user has subscriptions before processing any callback
  const subscribed = await checkSubscriptions(userId);
  if (!subscribed && data !== 'check_subs') {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: 'Для использования бота необходимо подписаться на все каналы!',
      show_alert: true
    });
    
    await bot.sendMessage(chatId, 
      `⚠️ Для доступа к функционалу бота необходимо подписаться на все каналы:`,
      getSubscriptionButtons()
    );
    return;
  }
  
  // Main menu callbacks
  switch (data) {
      case 'back_to_main':
        try {
          await bot.editMessageMedia(
            {
              type: 'photo',
              media: './image.png',
              caption: 'Главное меню 𝐆𝐀𝐋𝐀𝐗𝐘 𝐓𝐑𝐀𝐅𝐅𝐈𝐂 | 𝐓𝐄𝐀𝐌'
            },
            {
              chat_id: chatId,
              message_id: messageId,
              ...mainMenuKeyboard
            }
          );
        } catch (error) {
          console.error('Back button error:', error);
          // Fallback if edit fails
          await bot.sendPhoto(chatId, './image.png', {
            caption: 'Главное меню 𝐆𝐀𝐋𝐀𝐗𝐘 𝐓𝐑𝐀𝐅𝐅𝐈𝐂 | 𝐓𝐄𝐀𝐌',
            ...mainMenuKeyboard
          });
        }
        break;
      
    case 'profile':
      const profile = await getUserProfile(userId);
      if (!profile) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Ошибка получения профиля! ❌' });
        return;
      }
      
      await bot.sendPhoto(chatId, './image.png', {
        caption: `💻—Профиль\n┣🆔 Мой Username: @${profile.username}\n┣🆔 Мой ID: ${profile.userId}\n┣💰 Баланс: ${profile.balance.toFixed(1)}💵\n┗👥 Рефералы: ${profile.referralsCount}`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '👥 Мои рефералы', callback_data: 'referrals' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
          ]
        }
      });
      break;
      
    case 'statistics':
      const stats = await getBotStats();
      if (!stats) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Ошибка получения статистики! ❌' });
        return;
      }
      
      await bot.sendPhoto(chatId, './image.png', {
        caption: `𝐆𝐀𝐋𝐀𝐗𝐘 𝐓𝐑𝐀𝐅𝐅𝐈𝐂 | 𝐓𝐄𝐀𝐌\n📈— СТАТИСТИКА:\n┣Всего пользователей в боте: ${stats.total_users}\n┣За сегодня в бота зашло: ${stats.today_users}\n┗Всего выплачено пользователям: ${parseFloat(stats.total_paid).toFixed(1)}💵`,
        ...backButton
      });
      break;
      
      case 'functionality':
        await bot.sendPhoto(chatId, './image.png', {
          caption: '🔧 Функционал 𝐆𝐀𝐋𝐀𝐗𝐘 𝐓𝐑𝐀𝐅𝐅𝐈𝐂 | 𝐓𝐄𝐀𝐌\n\nВыберите нужный раздел:',
          ...functionalityKeyboard
        });
        break;
      
    case 'referrals':
      const referralInfo = await getReferralInfo(userId);
      
      await bot.sendPhoto(chatId, './image.png', {
        caption: `👥 — РЕФЕРАЛКА\n\nВаша ссылка: https://t.me/GalaxysTeamBot?start=${userId}\n\nВсего приглашено: ${referralInfo.referralsCount}\nВсего заработано с реф ссылки: ${referralInfo.totalEarnings.toFixed(1)}💵`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Скопировать ссылку', callback_data: `copy_link:${userId}` }],
            [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
          ]
        }
      });
      break;
      
    case 'manuals':
      await bot.sendPhoto(chatId, './image.png', {
        caption: '📚 Мануалы\n\nДоступные мануалы по заработку:',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📖 Открыть мануалы', url: 'https://t.me/c/2422397027/13' }],
            [{ text: '🔙 Назад', callback_data: 'functionality' }]
          ]
        }
      });
      break;
      
    case 'reviews':
      await bot.sendPhoto(chatId, './image.png', {
        caption: '⭐ Отзывы\n\nОтзывы наших пользователей:',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⭐ Смотреть отзывы', url: 'https://t.me/c/2422397027/12' }],
            [{ text: '🔙 Назад', callback_data: 'functionality' }]
          ]
        }
      });
      break;
      
    case 'required_subscriptions':
      await bot.sendPhoto(chatId, './image.png', {
        caption: '❗ Обязательные подписки\n\nДля использования бота необходимо быть подписанным на следующие каналы:',
        ...getSubscriptionButtons()
      });
      break;
      
      case 'payments':
        const userProfile = await getUserProfile(userId);
        if (!userProfile) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Ошибка получения профиля! ❌' });
          return;
        }
        
        // Проверка минимальной суммы (10 рефералов = 7$)
        const minWithdrawalAmount = 0.5;
        const refCount = await getReferralCount(userId);
        
        if (refCount < 1 || userProfile.balance < minWithdrawalAmount) {
          await bot.sendPhoto(chatId, './image.png', {
            caption: `💰 Выплаты\n\n❗️ Для выплаты необходимо пригласить минимум 10 человек (сейчас: ${refCount}) и иметь баланс не менее 7$.\n\nВаш текущий баланс: ${userProfile.balance.toFixed(1)}💵`,
            ...backButton
          });
          return;
        }
        
        await bot.sendPhoto(chatId, './image.png', {
          caption: `💰 Заказ выплаты\n\nВаш текущий баланс: ${userProfile.balance.toFixed(1)}💵\n\nДля подачи заявки на выплату, нажмите кнопку ниже:`,
          reply_markup: {
            inline_keyboard: [
              [{ text: '💸 Заказать выплату', callback_data: 'request_payment' }],
              [{ text: '🔙 Назад', callback_data: 'functionality' }]
            ]
          }
        });
        break;
      
        case 'request_payment':
          const paymentProfile = await getUserProfile(userId);
          const minAmount = 0;
          const referralCount = await getReferralCount(userId);
          
          if (!paymentProfile || paymentProfile.balance < minAmount || referralCount < 1) {
            await bot.answerCallbackQuery(callbackQuery.id, { 
              text: 'Недостаточно средств для выплаты или меньше 10 рефералов! ❌', 
              show_alert: true 
            });
            return;
          }
          
          // Запрос банковской карты
          await bot.sendMessage(chatId, 
            `💳 Для завершения заявки на выплату введите номер вашей банковской карты в следующем формате:\n\nXXXX-XXXX-XXXX-XXXX`
          );
          
          // Устанавливаем флаг для обработки ввода карты
          userStates[userId] = {
            awaitingCardInfo: true,
            amount: paymentProfile.balance
          };
          break;
      
    case (data.match(/^copy_link:(\d+)$/) || {}).input:
      const linkUserId = data.split(':')[1];
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `Ваша реферальная ссылка скопирована: https://t.me/GalaxysTeamBot?start=${linkUserId}`,
        show_alert: true
      });
      break;
  }
  
  // Admin callbacks
  if (userId.toString() === adminId) {
    if (data === 'admin_stats') {
      const adminStats = await getBotStats();
      
      await bot2.sendMessage(chatId, 
        `📊 Статистика бота\n\nВсего пользователей: ${adminStats.total_users}\nНовых сегодня: ${adminStats.today_users}\nВсего выплачено: ${parseFloat(adminStats.total_paid).toFixed(1)}💵`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад', callback_data: 'admin_back' }]
            ]
          }
        }
      );
    }
    
    if (data.startsWith('approve_payment:')) {
      const targetUserId = data.split(':')[1];
      
      try {
        // Get payment amount and info
        const paymentResult = await pool.query(
          'SELECT amount, card_number FROM payment_requests WHERE user_id = $1 AND status = $2 ORDER BY request_date DESC LIMIT 1',
          [targetUserId, 'pending']
        );
        
        if (paymentResult.rows.length > 0) {
          const amount = parseFloat(paymentResult.rows[0].amount);
          
          // Update payment status
          await pool.query(
            'UPDATE payment_requests SET status = $1 WHERE user_id = $2 AND status = $3',
            ['approved', targetUserId, 'pending']
          );
          
          // Reset user balance
          await pool.query('UPDATE users SET balance = 0 WHERE user_id = $1', [targetUserId]);
          
          // Update total paid
          await pool.query('UPDATE stats SET total_paid = total_paid + $1', [amount]);
          
          // Notify user
          await bot.sendMessage(targetUserId, 
            `✅ Ваша заявка на выплату ${amount.toFixed(1)}💵 была одобрена и обработана!`
          );
          
          await bot2.sendMessage(chatId, `✅ Выплата пользователю ID: ${targetUserId} на сумму ${amount.toFixed(1)}💵 успешно одобрена`);
        }
      } catch (error) {
        console.error('Error approving payment:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при обработке выплаты');
      }
    } else if (data.startsWith('reject_payment:')) {
      const targetUserId = data.split(':')[1];
      
      try {
        // Update payment status
        await pool.query(
          'UPDATE payment_requests SET status = $1 WHERE user_id = $2 AND status = $3',
          ['rejected', targetUserId, 'pending']
        );
        
        // Notify user
        await bot.sendMessage(targetUserId, 
          `❌ Ваша заявка на выплату была отклонена. По всем вопросам обращайтесь к @Mr_SnAyPeR`
        );
        
        await bot2.sendMessage(chatId, `❌ Выплата пользователю ID: ${targetUserId} отклонена`);
      } catch (error) {
        console.error('Error rejecting payment:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при отклонении выплаты');
      }
    } else if (data.startsWith('clear_user_history:')) {
      const targetUserId = data.split(':')[1];
      
      try {
        // Reset user balance and referrals
        await pool.query('UPDATE users SET balance = 0 WHERE user_id = $1', [targetUserId]);
        await pool.query('UPDATE users SET referrer_id = NULL WHERE referrer_id = $1', [targetUserId]);
        await pool.query('UPDATE payment_requests SET status = $1 WHERE user_id = $2 AND status = $3',
          ['canceled', targetUserId, 'pending']
        );
        
        // Notify user
        await bot.sendMessage(targetUserId, 
          `⚠️ Ваша история в боте была очищена администратором. Ваш баланс и рефералы сброшены.`
        );
        
        await bot2.sendMessage(chatId, `✅ История пользователя ID: ${targetUserId} успешно очищена`);
      } catch (error) {
        console.error('Error clearing user history:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при очистке истории пользователя');
      }
    }
  }
});

// Admin commands
bot2.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (userId.toString() !== adminId) {
    return bot.sendMessage(chatId, 'У вас нет доступа к админ-панели');
  }
  
  return bot2.sendMessage(chatId, 
    `Админ-панель 𝐆𝐀𝐋𝐀𝐗𝐘 𝐓𝐑𝐀𝐅𝐅𝐈𝐂 | 𝐓𝐄𝐀𝐌\n\nВыберите действие:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Статистика бота', callback_data: 'admin_stats' }],
          [{ text: '💰 Управление балансами', callback_data: 'admin_balance' }],
          [{ text: '👥 Управление рефералами', callback_data: 'admin_referrals' }],
          [{ text: '💸 Заявки на выплаты', callback_data: 'admin_payments' }]
        ]
      }
    }
  );
});

// Reset user referrals command
bot2.onText(/\/reset_refs (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const targetUserId = match[1];
  
  if (userId.toString() !== adminId) {
    return bot2.sendMessage(chatId, 'У вас нет доступа к этой команде');
  }
  
  const success = await resetUserReferrals(targetUserId);
  
  if (success) {
    return bot2.sendMessage(chatId, `Рефералы пользователя ID: ${targetUserId} были успешно сброшены`);
  } else {
    return bot2.sendMessage(chatId, 'Произошла ошибка при сбросе рефералов');
  }
});

// Reset user balance command
bot2.onText(/\/reset_balance (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const targetUserId = match[1];
  
  if (userId.toString() !== adminId) {
    return bot2.sendMessage(chatId, 'У вас нет доступа к этой команде');
  }
  
  const success = await resetUserBalance(targetUserId);
  
  if (success) {
    return bot2.sendMessage(chatId, `Баланс пользователя ID: ${targetUserId} был успешно сброшен`);
  } else {
    return bot2.sendMessage(chatId, 'Произошла ошибка при сбросе баланса');
  }
});


// Добавляем хранилище состояний пользователей для обработки ввода данных карты
const userStates = {};

// Обновляем обработчик текстовых сообщений для приема банковской карты
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  // Проверяем, ожидает ли бот ввода номера карты от пользователя
  if (userStates[userId] && userStates[userId].awaitingCardInfo) {
    if (text && text.startsWith('')) {
      const cardNumber = text.replace('').trim();
      const amount = userStates[userId].amount;
      
      try {
        // Создаем запрос на выплату с номером карты
        await pool.query(
          'INSERT INTO payment_requests (user_id, amount, card_number, status) VALUES ($1, $2, $3, $4)',
          [userId, amount, cardNumber, 'pending']
        );
        
        // Очищаем состояние
        delete userStates[userId];
        
        // Получаем информацию о пользователе и его рефералах
        const userInfo = await getUserProfile(userId);
        const referralsResult = await pool.query('SELECT user_id, username FROM users WHERE referrer_id = $1', [userId]);
        const referralsList = referralsResult.rows.map(ref => `- ID: ${ref.user_id}, @${ref.username}`).join('\n');
        
        // Отправляем подтверждение пользователю
        await bot.sendMessage(chatId, 
          `✅ Ваша заявка на выплату ${amount.toFixed(1)}💵 успешно отправлена!\n\nНомер карты: ${maskCardNumber(cardNumber)}\n\nОжидайте обработки администратором.`,
          mainMenuKeyboard
        );
        
        // Отправляем уведомление администратору с тремя кнопками
        await bot2.sendMessage(adminId, 
          `💸 Новая заявка на выплату\n\nПользователь: @${userInfo.username} (ID: ${userInfo.userId})\nСумма: ${amount.toFixed(1)}💵\nКарта: ${cardNumber}\n\nСписок рефералов (всего: ${userInfo.referralsCount}):\n${referralsList || 'Нет рефералов'}`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Одобрить', callback_data: `approve_payment:${userId}` },
                  { text: '❌ Отклонить', callback_data: `reject_payment:${userId}` }
                ],
                [{ text: '🗑️ Очистить историю пользователя', callback_data: `clear_user_history:${userId}` }]
              ]
            }
          }
        );
      } catch (error) {
        console.error('Error creating payment request:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при создании заявки. Пожалуйста, попробуйте позже.');
        delete userStates[userId];
      }
    } else {
      await bot.sendMessage(chatId, 
        `❌ Некорректный формат номера карты. Пожалуйста, введите в формате:\n\nВыплата XXXX-XXXX-XXXX-XXXX`
      );
    }
    return;
  }
  
  // Обработка команд и других сообщений продолжается как обычно...
});


// Функция для маскирования номера карты (показывает только последние 4 цифры)
function maskCardNumber(cardNumber) {
  // Удаляем все не-цифры
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  
  // Показываем только последние 4 цифры
  return '**** **** **** ' + digits.slice(-4);
}

// Обновляем функцию получения количества рефералов
async function getReferralCount(userId) {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [userId]);
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error getting referral count:', error);
    return 0;
  }
}

// Обновляем инициализацию базы данных для добавления поля card_number
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        balance NUMERIC DEFAULT 0,
        referrer_id BIGINT,
        join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS stats (
        id SERIAL PRIMARY KEY,
        total_users INTEGER DEFAULT 0,
        today_users INTEGER DEFAULT 0,
        total_paid NUMERIC DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS payment_requests (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        amount NUMERIC,
        card_number TEXT,
        status TEXT DEFAULT 'pending',
        request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );
      
      CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL
      );
      
      -- Проверяем, есть ли колонка card_number в таблице payment_requests
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'payment_requests' AND column_name = 'card_number'
        ) THEN
          ALTER TABLE payment_requests ADD COLUMN card_number TEXT;
        END IF;
      END $$;
    `);
    
    // Initialize stats if not exists
    const statsCheck = await pool.query('SELECT * FROM stats');
    if (statsCheck.rows.length === 0) {
      await pool.query('INSERT INTO stats DEFAULT VALUES');
    }
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Reset daily stats at midnight
function resetDailyStats() {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    pool.query('UPDATE stats SET today_users = 0');
    console.log('Daily stats reset');
  }
}

// Initialize bot
async function startBot() {
  try {
    // Initialize database
    await initializeDatabase();
    
    // Set up daily stats reset
    setInterval(resetDailyStats, 60 * 1000); // Check every minute
    
    console.log('Bot started successfully');
  } catch (error) {
    console.error('Error starting bot:', error);
  }
}

startBot();