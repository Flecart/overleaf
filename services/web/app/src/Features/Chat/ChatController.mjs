import { expressify } from '@overleaf/promise-utils'
import Modules from '../../infrastructure/Modules.mjs'
import ChatApiHandler from './ChatApiHandler.mjs'
import EditorRealTimeController from '../Editor/EditorRealTimeController.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import UserInfoManager from '../User/UserInfoManager.mjs'
import UserInfoController from '../User/UserInfoController.mjs'
import ChatManager from './ChatManager.mjs'
import fs from 'node:fs'
import path from 'node:path'

async function sendMessage(req, res) {
  const { project_id: projectId } = req.params
  const { content, client_id: clientId } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  const message = await ChatApiHandler.promises.sendGlobalMessage(
    projectId,
    userId,
    content
  )

  const user = await UserInfoManager.promises.getPersonalInfo(message.user_id)
  message.user = UserInfoController.formatPersonalInfo(user)
  message.clientId = clientId
  EditorRealTimeController.emitToRoom(projectId, 'new-chat-message', message)

  await Modules.promises.hooks.fire('chatMessageSent', {
    projectId,
    userId,
    messageId: message.id,
  })

  res.sendStatus(204)
}

async function getMessages(req, res) {
  const { project_id: projectId } = req.params
  const { query } = req
  const messages = await ChatApiHandler.promises.getGlobalMessages(
    projectId,
    query.limit,
    query.before
  )

  await ChatManager.promises.injectUserInfoIntoThreads({ global: { messages } })
  res.json(messages)
}

async function deleteMessage(req, res) {
  const { project_id: projectId, message_id: messageId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  await ChatApiHandler.promises.deleteGlobalMessage(projectId, messageId)

  EditorRealTimeController.emitToRoom(projectId, 'delete-global-message', {
    messageId,
    userId,
  })
  res.sendStatus(204)
}

async function editMessage(req, res, next) {
  const { project_id: projectId, message_id: messageId } = req.params
  const { content } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  await ChatApiHandler.promises.editGlobalMessage(
    projectId,
    messageId,
    userId,
    content
  )

  EditorRealTimeController.emitToRoom(projectId, 'edit-global-message', {
    messageId,
    userId,
    content,
  })
  res.sendStatus(204)
}

async function sendThreadMessage(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params
  const { content } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  const message = await ChatApiHandler.promises.sendComment(projectId, threadId, userId, content)

  const user = await UserInfoManager.promises.getPersonalInfo(message.user_id)
  message.user = UserInfoController.formatPersonalInfo(user)
  EditorRealTimeController.emitToRoom(projectId, 'new-comment', threadId, message)

  res.sendStatus(204)
}

async function getThreads(req, res) {
  const { project_id: projectId } = req.params
  const threads = await ChatApiHandler.promises.getThreads(projectId)

  await ChatManager.promises.injectUserInfoIntoThreads(threads)
  res.json(threads)
}

async function resolveThread(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  await ChatApiHandler.promises.resolveThread(projectId, threadId, userId)

  EditorRealTimeController.emitToRoom(projectId, 'resolve-thread', threadId, userId)
  res.sendStatus(204)
}

async function reopenThread(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params

  await ChatApiHandler.promises.reopenThread(projectId, threadId)

  EditorRealTimeController.emitToRoom(projectId, 'reopen-thread', threadId)
  res.sendStatus(204)
}

async function deleteThreadMessage(req, res) {
  const { project_id: projectId, thread_id: threadId, message_id: messageId } =
    req.params

  await ChatApiHandler.promises.deleteMessage(projectId, threadId, messageId)
  res.sendStatus(204)
}

async function editThreadMessage(req, res) {
  const { project_id: projectId, thread_id: threadId, message_id: messageId } =
    req.params
  const { content } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  await ChatApiHandler.promises.editMessage(
    projectId,
    threadId,
    messageId,
    userId,
    content
  )
  res.sendStatus(204)
}

async function deleteThread(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params

  await ChatApiHandler.promises.deleteThread(projectId, threadId)

  EditorRealTimeController.emitToRoom(projectId, 'delete-thread', threadId)
  res.sendStatus(204)
}

async function logAITutorSuggestions(req, res) {
  const { project_id: projectId } = req.params
  const { timestamp, abstract, suggestions, model } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)

  if (!userId) {
    return res.sendStatus(401)
  }

  try {
    // Create logs directory if it doesn't exist
    const logDir = '/var/lib/overleaf/ai-tutor-logs'
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }

    // Create a log entry
    const logEntry = {
      timestamp,
      projectId,
      userId: userId.toString(),
      model,
      abstractLength: abstract.length,
      suggestionsCount: suggestions.length,
      suggestions: suggestions.map(s => ({
        text: s.text,
        comment: s.comment,
      })),
    }

    // Append to daily log file
    const date = new Date(timestamp).toISOString().split('T')[0]
    const logFile = path.join(logDir, `ai-tutor-${date}.jsonl`)
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n')

    res.sendStatus(204)
  } catch (error) {
    console.error('Failed to log AI tutor suggestions:', error)
    // Don't fail the request - logging is optional
    res.sendStatus(204)
  }
}

export default {
  sendMessage: expressify(sendMessage),
  getMessages: expressify(getMessages),
  deleteMessage: expressify(deleteMessage),
  editMessage: expressify(editMessage),
  sendThreadMessage: expressify(sendThreadMessage),
  getThreads: expressify(getThreads),
  resolveThread: expressify(resolveThread),
  reopenThread: expressify(reopenThread),
  deleteThreadMessage: expressify(deleteThreadMessage),
  editThreadMessage: expressify(editThreadMessage),
  deleteThread: expressify(deleteThread),
  logAITutorSuggestions: expressify(logAITutorSuggestions),
}
