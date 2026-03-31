import type { InputRenderable, KeyEvent } from "@opentui/core"

export type VimPendingOperator = "delete" | "change" | "change-inner" | null

export type VimKeyResult = {
  readonly handled: boolean
  readonly nextOperator: VimPendingOperator
  readonly enterInsertMode?: boolean
}

export function handleNormalModeKey(
  input: InputRenderable | null,
  key: KeyEvent,
  pendingOperator: VimPendingOperator,
): VimKeyResult {
  if (!input) {
    return { handled: false, nextOperator: pendingOperator }
  }

  if (key.ctrl || key.meta || key.option) {
    return { handled: false, nextOperator: pendingOperator }
  }

  if (pendingOperator === "delete") {
    return handleDeleteOperator(input, key)
  }

  if (pendingOperator === "change") {
    return handleChangeOperator(input, key)
  }

  if (pendingOperator === "change-inner") {
    if (matchesKey(key, "w")) {
      deleteInnerWord(input)
      return { handled: true, nextOperator: null, enterInsertMode: true }
    }
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "h") || key.name === "left") {
    input.moveCursorLeft()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "l") || key.name === "right") {
    input.moveCursorRight()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "w")) {
    input.moveWordForward()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "b")) {
    input.moveWordBackward()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "0") || key.name === "home") {
    input.gotoLineHome()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "$") || key.name === "end") {
    input.gotoLineEnd()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "x")) {
    input.deleteChar()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "u")) {
    input.undo()
    return { handled: true, nextOperator: null }
  }

  if (key.ctrl && matchesKey(key, "r")) {
    input.redo()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "D")) {
    input.deleteToLineEnd()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "C")) {
    input.deleteToLineEnd()
    return { handled: true, nextOperator: null, enterInsertMode: true }
  }

  if (matchesKey(key, "d")) {
    return { handled: true, nextOperator: "delete" }
  }

  if (matchesKey(key, "c")) {
    return { handled: true, nextOperator: "change" }
  }

  return { handled: false, nextOperator: null }
}

function handleDeleteOperator(
  input: InputRenderable,
  key: KeyEvent,
): VimKeyResult {
  if (matchesKey(key, "d")) {
    input.clear()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "w")) {
    input.deleteWordForward()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "b")) {
    input.deleteWordBackward()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "0")) {
    input.deleteToLineStart()
    return { handled: true, nextOperator: null }
  }

  if (matchesKey(key, "$") || key.name === "end") {
    input.deleteToLineEnd()
    return { handled: true, nextOperator: null }
  }

  return { handled: true, nextOperator: null }
}

function handleChangeOperator(
  input: InputRenderable,
  key: KeyEvent,
): VimKeyResult {
  if (matchesKey(key, "i")) {
    return { handled: true, nextOperator: "change-inner" }
  }

  if (matchesKey(key, "w")) {
    input.deleteWordForward()
    return { handled: true, nextOperator: null, enterInsertMode: true }
  }

  if (matchesKey(key, "c")) {
    input.clear()
    return { handled: true, nextOperator: null, enterInsertMode: true }
  }

  if (matchesKey(key, "$") || key.name === "end") {
    input.deleteToLineEnd()
    return { handled: true, nextOperator: null, enterInsertMode: true }
  }

  return { handled: true, nextOperator: null }
}

function deleteInnerWord(input: InputRenderable): void {
  const text = input.value
  const cursor = input.cursorOffset

  if (!text) return

  let start = cursor
  while (start > 0 && isWordChar(text[start - 1] ?? "")) {
    start -= 1
  }

  let end = cursor
  while (end < text.length && isWordChar(text[end] ?? "")) {
    end += 1
  }

  if (start === end) {
    while (start > 0 && !isWordChar(text[start - 1] ?? "")) {
      start -= 1
    }
    while (end < text.length && !isWordChar(text[end] ?? "")) {
      end += 1
    }
    while (start > 0 && isWordChar(text[start - 1] ?? "")) {
      start -= 1
    }
    while (end < text.length && isWordChar(text[end] ?? "")) {
      end += 1
    }
  }

  const nextText = `${text.slice(0, start)}${text.slice(end)}`
  input.replaceText(nextText)
  input.cursorOffset = start
}

function isWordChar(value: string): boolean {
  return /[A-Za-z0-9_./-]/.test(value)
}

function matchesKey(key: KeyEvent, expected: string): boolean {
  return key.sequence === expected || key.name === expected
}
