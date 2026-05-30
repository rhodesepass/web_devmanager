import { createRouter, createWebHistory } from 'vue-router'

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

export default router
