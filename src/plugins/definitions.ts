import type { IconName } from '../Icon';
import type { TranslationKey } from '../i18n';
import type { CleanupMode, ExtractionMode, FusionMode } from '../types';

export const localEditStageKeys: Record<string, TranslationKey> = { planning: 'ws.stagePlanning', compositing: 'ws.stageCompositing', generating: 'ws.stageGenerating', preserving: 'ws.stagePreserving' };
export const removeElementStageKeys: Record<string, TranslationKey> = { planning: 'ws.removeElementStagePlanning', generating: 'ws.removeElementStageGenerating', preserving: 'ws.removeElementStagePreserving' };
export const cleanupModeKeys: Record<CleanupMode, TranslationKey> = { selection: 'cleanup.selection', people: 'cleanup.people', clutter: 'cleanup.clutter', text: 'cleanup.text', room: 'cleanup.room' };
export const cleanupDescriptionKeys: Record<CleanupMode, TranslationKey> = { selection: 'cleanup.selectionDescription', people: 'cleanup.peopleDescription', clutter: 'cleanup.clutterDescription', text: 'cleanup.textDescription', room: 'cleanup.roomDescription' };
export const cleanupIcons: Record<CleanupMode, IconName> = { selection: 'box', people: 'users', clutter: 'trash', text: 'edit', room: 'home' };
export const cleanupStageKeys: Record<string, TranslationKey> = { planning: 'cleanup.stagePlanning', generating: 'cleanup.stageGenerating', preserving: 'cleanup.stagePreserving' };
export const extractionModeKeys: Record<ExtractionMode, TranslationKey> = { selection: 'extract.selection', clothing: 'extract.clothing', accessory: 'extract.accessory', pattern: 'extract.pattern', background: 'extract.background' };
export const extractionDescriptionKeys: Record<ExtractionMode, TranslationKey> = { selection: 'extract.selectionDescription', clothing: 'extract.clothingDescription', accessory: 'extract.accessoryDescription', pattern: 'extract.patternDescription', background: 'extract.backgroundDescription' };
export const extractionIcons: Record<ExtractionMode, IconName> = { selection: 'box', clothing: 'shirt', accessory: 'gem', pattern: 'grid', background: 'image' };
export const fusionTypeKeys: Record<FusionMode, TranslationKey> = { basic: 'fusion.basic', outfit: 'fusion.outfit', pose: 'fusion.pose', group: 'fusion.group' };
export const fusionTypeIcons: Record<FusionMode, IconName> = { basic: 'layers', outfit: 'shirt', pose: 'pose', group: 'users' };
export const fusionDescriptionKeys: Record<FusionMode, TranslationKey> = { basic: 'fusion.basicDescription', outfit: 'fusion.outfitDescription', pose: 'fusion.poseDescription', group: 'fusion.groupDescription' };
