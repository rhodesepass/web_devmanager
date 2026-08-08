/** 焦点在可输入元素上时快捷键必须放行（否则吞掉输入框里的空格/删除） */
export function isEditableTarget (target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.isContentEditable
}
