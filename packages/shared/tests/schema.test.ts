import { describe, expect, it } from 'vitest';
import { validateBuildScene } from '../src/schema.js';

const validInput = {
  schemaVersion: 1,
  scene: 'Shoot',
  design: { w: 720, h: 1280, fitWidth: true },
  options: { onExists: 'upsert', transaction: true, save: true },
  root: {
    id: 'canvas',
    name: 'Canvas',
    components: ['Canvas', { type: 'Widget', align: 'center' }],
    children: [
      {
        id: 'shutter',
        name: 'shutterBtn',
        type: 'Button',
        label: { text: '拍摄', fontSize: 30 },
        position: { x: 0, y: -500 },
        contentSize: { w: 200, h: 60 },
      },
      {
        id: 'score',
        name: 'scoreLabel',
        type: 'Label',
        text: '',
        fontSize: 28,
        position: { x: 0, y: 300 },
      },
    ],
    script: {
      class: 'ShootScene',
      refs: { shutterBtn: 'shutter', scoreLabel: 'score' },
    },
  },
};

describe('validateBuildScene', () => {
  it('接受合法的场景 JSON', () => {
    const r = validateBuildScene(validInput);
    expect(r.valid).toBe(true);
    expect(r.data?.root.name).toBe('Canvas');
  });

  it('拒绝错误的 schemaVersion', () => {
    const r = validateBuildScene({ ...validInput, schemaVersion: 2 });
    expect(r.valid).toBe(false);
    expect(r.issues.join('\n')).toContain('schemaVersion');
  });

  it('拒绝非法颜色', () => {
    const bad = structuredClone(validInput) as any;
    bad.root.children[0].color = 'red';
    const r = validateBuildScene(bad);
    expect(r.valid).toBe(false);
    expect(r.issues.join('\n')).toContain('颜色');
  });

  it('拒绝重复 id', () => {
    const bad = structuredClone(validInput) as any;
    bad.root.children[1].id = 'shutter';
    const r = validateBuildScene(bad);
    expect(r.valid).toBe(false);
  });

  it('refs 指向不存在的 id 时报错', () => {
    const bad = structuredClone(validInput) as any;
    bad.root.script.refs.scoreLabel = 'not-exist';
    const r = validateBuildScene(bad);
    expect(r.valid).toBe(false);
    expect(r.issues.join('\n')).toContain('not-exist');
  });

  it('options 缺省时给出默认值', () => {
    const minimal = {
      schemaVersion: 1,
      root: { name: 'Canvas', components: ['Canvas'] },
    };
    const r = validateBuildScene(minimal);
    expect(r.valid).toBe(true);
    expect((r.data as any).options.onExists).toBe('upsert');
  });
});
