import { createPluginRegistry } from './registry.mjs';
import localEdit from './local-edit.mjs';
import removeElement from './remove-element.mjs';
import extractAsset from './extract-asset.mjs';
import fusion from './fusion.mjs';

import outpaint from './outpaint.mjs';
import enhance from './enhance.mjs';
import removeBackground from './remove-background.mjs';
import removeWatermark from './remove-watermark.mjs';
import editText from './edit-text.mjs';
import { loadRecipes } from './recipes.mjs';

const builtins = [localEdit, removeElement, extractAsset, fusion, outpaint, enhance, removeBackground, removeWatermark, editText];
const recipes = loadRecipes(undefined, builtins);
export const recipeLoadErrors = recipes.errors;
export const imagePlugins = createPluginRegistry([...builtins, ...recipes.plugins]);
