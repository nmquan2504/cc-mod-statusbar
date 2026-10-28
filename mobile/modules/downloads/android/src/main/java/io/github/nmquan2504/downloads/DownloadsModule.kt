package io.github.nmquan2504.downloads

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// A file written into the phone's Downloads through MediaStore: no folder picker and no permission
// (Android 10 and later). Given as bytes alone, so Android keeps the name whole and takes the type
// from its extension; a name this app saved before gets a number before the extension, report (1).pdf
// (Android's own would follow it, report.pdf (1), and the file would no longer open on a tap).
// Answers the name it has.
class DownloadsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Downloads")

    AsyncFunction("save") { name: String, b64: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw CodedException("ERR_OLD_ANDROID", "Saving needs Android 10 or later.", null)
      val resolver = (appContext.reactContext ?: throw Exceptions.ReactContextLost()).contentResolver
      // only this app's own files are seen here, the ones it would clash with on a second save
      val taken = { n: String ->
        resolver.query(
          MediaStore.Downloads.EXTERNAL_CONTENT_URI, arrayOf(MediaStore.Downloads._ID),
          "${MediaStore.Downloads.DISPLAY_NAME}=? AND ${MediaStore.Downloads.RELATIVE_PATH}=?",
          arrayOf(n, Environment.DIRECTORY_DOWNLOADS + "/"), null
        )?.use { it.count > 0 } ?: false
      }
      val dot = name.lastIndexOf('.').takeIf { it > 0 } ?: name.length
      var unique = name
      var n = 0
      while (taken(unique)) unique = "${name.substring(0, dot)} (${++n})${name.substring(dot)}"
      val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, unique)
        put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream")
        put(MediaStore.Downloads.IS_PENDING, 1)
      }
      val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw CodedException("ERR_SAVE", "Could not save the file.", null)
      try {
        (resolver.openOutputStream(uri) ?: throw CodedException("ERR_SAVE", "Could not save the file.", null))
          .use { it.write(Base64.decode(b64, Base64.DEFAULT)) }
        resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
      } catch (e: Throwable) {
        resolver.delete(uri, null, null)
        throw e
      }
      resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null
      } ?: unique
    }
  }
}
