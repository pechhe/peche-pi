import assert from "node:assert/strict";
import test from "node:test";
import type { SessionQueuedMessage } from "@pi-gui/session-driver/types";
import {
  cloneQueuedMessage,
  deliverQueuedMessage,
  deliverQueuedPrompt,
  promptTextForQueuedDelivery,
  queuedPromptImagesFromAttachments,
  reconcileQueuedMessagesForStartedUserMessage,
} from "../src/queued-message-delivery.ts";

test("cloneQueuedMessage protects attachment Locality", () => {
  const original: SessionQueuedMessage = {
    id: "queued-1",
    mode: "followUp",
    text: "inspect image",
    attachments: [{ kind: "image", data: "abc", mimeType: "image/png" }],
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
  };

  const cloned = cloneQueuedMessage(original);

  assert.deepEqual(cloned, original);
  assert.notEqual(cloned.attachments, original.attachments);
  assert.notEqual(cloned.attachments?.[0], original.attachments?.[0]);
});

test("queuedPromptImagesFromAttachments returns only image payloads", () => {
  const images = queuedPromptImagesFromAttachments([
    { kind: "file", path: "/tmp/a.txt", name: "a.txt", content: "hello" },
    { kind: "image", data: "raw", mimeType: "image/jpeg" },
  ]);

  assert.deepEqual(images, [{ type: "image", data: "raw", mimeType: "image/jpeg" }]);
});

test("promptTextForQueuedDelivery keeps file preamble in queued delivery Seam", () => {
  const text = promptTextForQueuedDelivery("summarize", [
    { kind: "file", path: "/tmp/a.txt", name: "a.txt", content: "hello" },
  ]);

  assert.match(text, /<pi-gui-file-attachments>/);
  assert.match(text, /a\.txt/);
  assert.match(text, /summarize/);
});

test("deliverQueuedPrompt dispatches steer and copies image arrays", async () => {
  const calls: unknown[] = [];
  const images = [{ type: "image" as const, data: "raw", mimeType: "image/png" }];

  await deliverQueuedPrompt({
    steer: async (text, passedImages) => calls.push(["steer", text, passedImages]),
    followUp: async (text, passedImages) => calls.push(["followUp", text, passedImages]),
  }, "guide", "steer", images);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["steer", "guide", images]);
  assert.notEqual((calls[0] as unknown[])[2], images);
});

test("deliverQueuedMessage dispatches follow-up with attachment prompt data", async () => {
  const calls: unknown[] = [];

  await deliverQueuedMessage({
    steer: async (text, images) => calls.push(["steer", text, images]),
    followUp: async (text, images) => calls.push(["followUp", text, images]),
  }, {
    id: "queued-1",
    mode: "followUp",
    text: "use attachment",
    attachments: [{ kind: "image", data: "raw", mimeType: "image/png" }],
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
  });

  assert.deepEqual(calls, [["followUp", "use attachment", [{ type: "image", data: "raw", mimeType: "image/png" }]]]);
});

test("reconcileQueuedMessagesForStartedUserMessage removes matching steer before follow-up", () => {
  const queuedMessages: SessionQueuedMessage[] = [
    { id: "follow", mode: "followUp", text: "same", createdAt: "t", updatedAt: "t" },
    { id: "steer", mode: "steer", text: "same", createdAt: "t", updatedAt: "t" },
  ];

  const result = reconcileQueuedMessagesForStartedUserMessage(queuedMessages, {
    role: "user",
    content: [{ type: "text", text: "same" }],
  });

  assert.equal(result.started?.id, "steer");
  assert.deepEqual(result.queuedMessages.map((message) => message.id), ["follow"]);
  assert.deepEqual(queuedMessages.map((message) => message.id), ["follow", "steer"]);
});
