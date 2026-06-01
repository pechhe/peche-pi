import * as v from "valibot";
import {
  ClientCommandEnvelopeSchema,
  ServerEnvelopeSchema,
} from "./schemas.js";
import { CommandSchemas, type CommandName } from "./commands.js";
import { EventSchemas, type EventName } from "./events.js";

/**
 * Parsed + validated client command. The `command` field narrows `payload`
 * to the matching Valibot inferred type.
 */
export interface ClientCommand {
  readonly type: "command";
  readonly id: string;
  readonly command: CommandName;
  readonly payload: unknown;
}

export type ServerEnvelope = v.InferOutput<typeof ServerEnvelopeSchema>;

/**
 * Validate a client-sent command envelope. Throws a `ValiError` on failure.
 *
 * The payload is parsed against the command-specific schema only when the
 * command name is known. Unknown commands are rejected — the protocol is a
 * closed set, not an open RPC bus.
 */
export function parseClientCommand(value: unknown): ClientCommand {
  const envelope = v.parse(ClientCommandEnvelopeSchema, value);
  const schema = (CommandSchemas as Record<string, v.GenericSchema | undefined>)[
    envelope.command
  ];
  if (!schema) {
    const result = v.safeParse(v.never(), envelope.payload);
    throw result.issues;
  }
  const payload = v.parse(schema, envelope.payload);
  return {
    type: "command",
    id: envelope.id,
    command: envelope.command as CommandName,
    payload,
  };
}

export function parseServerEnvelope(value: unknown): ServerEnvelope {
  return v.parse(ServerEnvelopeSchema, value);
}

export function parseEventPayload<E extends EventName>(
  event: E,
  value: unknown,
): v.InferOutput<(typeof EventSchemas)[E]> {
  return v.parse(EventSchemas[event] as v.GenericSchema, value) as v.InferOutput<
    (typeof EventSchemas)[E]
  >;
}

export function parseCommandPayload<C extends CommandName>(
  command: C,
  value: unknown,
): v.InferOutput<(typeof CommandSchemas)[C]> {
  return v.parse(CommandSchemas[command] as v.GenericSchema, value) as v.InferOutput<
    (typeof CommandSchemas)[C]
  >;
}
