import { createRouter, createWebHistory } from 'vue-router'
import { useTransferLock } from '@/composables/useTransferLock'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/pages/connection.vue'),
    },
    {
      path: '/files',
      component: () => import('@/pages/files.vue'),
    },
    {
      path: '/materials',
      component: () => import('@/pages/materials.vue'),
    },
    {
      path: '/materials/share',
      component: () => import('@/pages/materialShare.vue'),
      meta: { embedCapable: true },
    },
    {
      path: '/apps',
      component: () => import('@/pages/apps.vue'),
    },
    {
      path: '/apps/share',
      component: () => import('@/pages/appShare.vue'),
      meta: { embedCapable: true },
    },
    {
      path: '/editor',
      component: () => import('@/pages/editor.vue'),
    },
    {
      path: '/editor/cut/:segment(loop|intro)',
      component: () => import('@/pages/editorCut.vue'),
      meta: { fullscreen: true },
    },
    {
      path: '/dispimg',
      component: () => import('@/pages/dispImg.vue'),
    },
    {
      path: '/terminal',
      component: () => import('@/pages/terminal.vue'),
    },
    {
      path: '/flash',
      component: () => import('@/pages/flash.vue'),
    },
    {
      path: '/repro',
      component: () => import('@/pages/reproGuide.vue'),
    },
  ],
})

router.beforeEach((to, from) => {
  const { active } = useTransferLock()
  if (active.value && to.path !== from.path) {
    return false
  }
})

export default router
