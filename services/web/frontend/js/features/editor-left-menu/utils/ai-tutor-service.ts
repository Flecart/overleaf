import { postJSON } from '@/infrastructure/fetch-json'

export interface FileCategory {
  description: string
  files: string[]
  references?: string[]
  count: number
}

export interface WholeProjectMetadata {
  projectId: string
  projectName: string
  rootDocPath: string
  analyzedAt: string
  categories: {
    texFiles: FileCategory
    figures: FileCategory
    bibFiles: FileCategory
    usefulFiles: FileCategory
    irrelevantFiles: FileCategory
  }
  mergedTexPath: string
  mergedTexLength: number
  totalDocs: number
  totalFiles: number
}

export async function analyzeWholeProject(
  projectId: string
): Promise<{
  success: boolean
  metadata?: WholeProjectMetadata
  error?: string
}> {
  try {
    const metadata = (await postJSON(
      `/project/${projectId}/ai-tutor-analyze`
    )) as WholeProjectMetadata
    return { success: true, metadata }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'An unknown error occurred.',
    }
  }
}

export interface AIComment {
  text: string
  comment: string
  startOffset: number
  endOffset: number
}

export interface AIAnalysisResult {
  success: boolean
  comments: AIComment[]
  error?: string
}

/**
 * Extracts the abstract content from a LaTeX document
 */
export function extractAbstract(
  documentContent: string
): { content: string; startPos: number; endPos: number } | null {
  const abstractRegex = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/
  const match = documentContent.match(abstractRegex)

  if (!match) {
    return null
  }

  const fullMatch = match[0]
  const rawContent = match[1]
  const abstractContent = rawContent.trim()
  const matchStart = documentContent.indexOf(fullMatch)
  const rawContentStart = matchStart + fullMatch.indexOf(rawContent)
  // Account for leading whitespace removed by trim()
  const leadingWhitespace = rawContent.length - rawContent.trimStart().length
  const startPos = rawContentStart + leadingWhitespace

  return {
    content: abstractContent,
    startPos,
    endPos: startPos + abstractContent.length,
  }
}

/**
 * Calls OpenAI API to analyze the abstract and generate comments
 */
export async function analyzeAbstractWithOpenAI(
  apiKey: string,
  abstractContent: string,
  abstractStartPos: number
): Promise<AIAnalysisResult> {
  const systemPrompt = `You are an expert academic writing tutor. Your task is to review an abstract from an academic paper and provide constructive feedback as inline comments.

For each piece of feedback, you must identify a specific phrase or sentence in the abstract that your comment applies to. Your response must be a valid JSON array of objects, where each object has:
- "text": the exact text from the abstract that your comment applies to (must be an exact substring)
- "comment": your constructive feedback for that specific part

Focus on:
1. Clarity and conciseness
2. Academic writing style
3. Logical flow and structure
4. Grammar and word choice improvements
5. Suggestions for stronger or more precise language

Provide 3-6 targeted comments. Each comment should be actionable and specific.

IMPORTANT: Return ONLY a valid JSON array, no other text. Example format:
[
  {"text": "exact phrase from abstract", "comment": "Your suggestion here"},
  {"text": "another exact phrase", "comment": "Another suggestion"}
]`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Please review this abstract and provide inline comments:\n\n${abstractContent}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      if (response.status === 401) {
        return {
          success: false,
          comments: [],
          error: 'Invalid API key. Please check your OpenAI API key.',
        }
      }
      if (response.status === 429) {
        return {
          success: false,
          comments: [],
          error: 'Rate limit exceeded. Please try again later.',
        }
      }
      return {
        success: false,
        comments: [],
        error:
          errorData.error?.message || `API request failed: ${response.status}`,
      }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return {
        success: false,
        comments: [],
        error: 'No response from OpenAI.',
      }
    }

    // Parse the JSON response
    let parsedComments: { text: string; comment: string }[]
    try {
      // Handle potential markdown code blocks in response
      let jsonContent = content.trim()
      if (jsonContent.startsWith('```json')) {
        jsonContent = jsonContent.slice(7)
      }
      if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.slice(3)
      }
      if (jsonContent.endsWith('```')) {
        jsonContent = jsonContent.slice(0, -3)
      }
      parsedComments = JSON.parse(jsonContent.trim())
    } catch {
      return {
        success: false,
        comments: [],
        error: 'Failed to parse AI response. Please try again.',
      }
    }

    // Map comments to document positions
    const comments: AIComment[] = []
    for (const item of parsedComments) {
      const textIndex = abstractContent.indexOf(item.text)
      if (textIndex !== -1) {
        comments.push({
          text: item.text,
          comment: `[AI Tutor] ${item.comment}`,
          startOffset: abstractStartPos + textIndex,
          endOffset: abstractStartPos + textIndex + item.text.length,
        })
      }
    }

    if (comments.length === 0) {
      return {
        success: false,
        comments: [],
        error:
          'AI generated comments but could not match them to the abstract text.',
      }
    }

    return {
      success: true,
      comments,
    }
  } catch (error) {
    return {
      success: false,
      comments: [],
      error:
        error instanceof Error ? error.message : 'An unknown error occurred.',
    }
  }
}
