import deepseek from './deepseek.js';
import kimi from './kimi.js';
import qwen from './qwen.js';
import doubao from './doubao.js';
import zhipu from './zhipu.js';
import wenxin from './wenxin.js';
import yuanbao from './yuanbao.js';
import xiaomi from './xiaomi.js';
import wencai from './wencai.js';

// Registry of enabled adapters. Add new sites here as their adapters are built.
export const adapters = [deepseek, kimi, qwen, doubao, zhipu, wenxin, yuanbao, xiaomi, wencai];

export const adapterById = Object.fromEntries(adapters.map((a) => [a.id, a]));
