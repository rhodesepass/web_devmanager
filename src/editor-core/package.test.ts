import { describe, expect, it } from 'vitest'
import { createProject } from './model'
import { buildMaterialFiles } from './package'
import { serializeProject } from './serialize'

describe('buildMaterialFiles', () => {
  const base = {
    uuid: 'u-1',
    loopMp4: new Uint8Array([1]),
    introMp4: null,
    iconPng: null,
    logoPng: null,
    classIconPng: null,
    overlayImagePng: null,
  }

  it('projectJson 非空时打包 project.epedit.json 且内容可反解', () => {
    const project = createProject()
    const json = serializeProject(project)
    const files = buildMaterialFiles({ ...base, project, projectJson: json })
    const entry = files.find(f => f.name === 'project.epedit.json')
    expect(entry).toBeDefined()
    expect(new TextDecoder().decode(entry!.data)).toBe(json)
    expect(files.some(f => f.name === 'epconfig.json')).toBe(true)
    expect(files.some(f => f.name === 'loop.mp4')).toBe(true)
  })

  it('projectJson 为 null 时不打包', () => {
    const files = buildMaterialFiles({ ...base, project: createProject(), projectJson: null })
    expect(files.some(f => f.name === 'project.epedit.json')).toBe(false)
  })
})
