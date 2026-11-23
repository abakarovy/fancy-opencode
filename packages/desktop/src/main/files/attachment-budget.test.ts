import { describe, expect, test } from "bun:test"
import { assertAttachmentBudget, MAX_ATTACHMENT_BYTES } from "./attachment-picker"

const MB = 1024 * 1024

describe("picker byte budget", () => {
  test("attachments keep the default limit", () => {
    expect(() => assertAttachmentBudget([{ size: 32 * MB }])).toThrow()
    expect(() => assertAttachmentBudget([{ size: MAX_ATTACHMENT_BYTES }])).not.toThrow()
  })

  test("a caller can lift the limit for its own selection", () => {
    expect(() => assertAttachmentBudget([{ size: 32 * MB }], Number.MAX_SAFE_INTEGER)).not.toThrow()
  })
})
