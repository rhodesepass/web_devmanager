import { ref } from 'vue'
import type { SnackbarQueueMessage } from 'vuetify'

export type NotificationType = 'success' | 'info' | 'warning' | 'error'

const notifications = ref<SnackbarQueueMessage[]>([])

const prependIcons: Record<NotificationType, string> = {
  success: 'mdi-check-circle',
  info: 'mdi-information',
  warning: 'mdi-alert',
  error: 'mdi-alert-circle',
}

export function useNotifications () {
  function notify (
    message: string,
    type: NotificationType = 'info',
    timeout = 4000,
  ) {
    notifications.value.push({
      text: message,
      color: type,
      timeout,
      prependIcon: prependIcons[type],
    })
  }

  function dismissAll () {
    notifications.value = []
  }

  return { notifications, notify, dismissAll }
}
