import { app, ipcMain } from 'electron'

export function hideDockIcon(): void {
  if (process.platform === 'darwin') app.dock?.hide()
}

ipcMain.handle('getAppVersion', () => app.getVersion())
