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
      path: '/terminal',
      component: () => import('@/pages/terminal.vue'),
    },
    {
      path: '/flash',
      component: () => import('@/pages/flash.vue'),
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
