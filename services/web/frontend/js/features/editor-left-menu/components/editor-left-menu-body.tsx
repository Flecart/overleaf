import DownloadMenu from './download-menu'
import ActionsMenu from './actions-menu'
import HelpMenu from './help-menu'
import SyncMenu from './sync-menu'
import SettingsMenu from './settings-menu'
import AITutorMenu from './ai-tutor-menu'

export default function EditorLeftMenuBody() {
  return (
    <>
      <DownloadMenu />
      <ActionsMenu />
      <AITutorMenu />
      <SyncMenu />
      <SettingsMenu />
      <HelpMenu />
    </>
  )
}
