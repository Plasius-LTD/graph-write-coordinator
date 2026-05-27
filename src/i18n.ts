import { graphWriteCoordinatorEnGbTranslations } from "./translations/en-GB.js";

export const graphWriteCoordinatorTranslationKeys = {
  invalidWriteCommandPayloadMessage:
    "graphWriteCoordinator.error.writeCommandInvalid.message",
} as const;

export type GraphWriteCoordinatorTranslationKey =
  (typeof graphWriteCoordinatorTranslationKeys)[keyof typeof graphWriteCoordinatorTranslationKeys];

export const graphWriteCoordinatorErrorCodes = {
  writeCommandInvalid: "WRITE_COMMAND_INVALID",
} as const;

export type GraphWriteCoordinatorErrorCode =
  (typeof graphWriteCoordinatorErrorCodes)[keyof typeof graphWriteCoordinatorErrorCodes];

export const graphWriteCoordinatorErrorMessageKeysByCode = {
  [graphWriteCoordinatorErrorCodes.writeCommandInvalid]:
    graphWriteCoordinatorTranslationKeys.invalidWriteCommandPayloadMessage,
} as const satisfies Record<
  GraphWriteCoordinatorErrorCode,
  GraphWriteCoordinatorTranslationKey
>;

export { graphWriteCoordinatorEnGbTranslations };

export const graphWriteCoordinatorTranslations = {
  "en-GB": graphWriteCoordinatorEnGbTranslations,
} as const;

/**
 * Resolve package-owned defaults for environments that do not register an
 * external translation provider.
 */
export function getGraphWriteCoordinatorDefaultTranslation(
  key: GraphWriteCoordinatorTranslationKey,
): string {
  return graphWriteCoordinatorEnGbTranslations[key] ?? key;
}
