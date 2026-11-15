' ============================================================================================
' RMG Desk: "Notify RMG Desk" code action node for the MRI Evolution events workflow (F_EVENTS, INSERT).
'
' Uses the workflow properties set by the "Set Values PAUSED / RESUMED / STARTED" property setters:
'   reqId, taskSeq, eventName, eventSeq, eventAt, resource, comments
' eventAt can be the Date Actioned itself (a date) or text such as 13/11/2026 16:05 (UK time).
'
' Only sends for RMG- tasks, and never stops the workflow: problems go to the workflow trace.
' Set "Error and continue" to True on this node.
' ============================================================================================
Dim rmgDeskUrl As String = "https://PASTE-API-ID.execute-api.eu-west-2.amazonaws.com/integrations/evolution/task-status"
Dim rmgDeskToken As String = "PASTE-TOKEN-HERE"

Try
    Dim id As String = ""
    If reqId IsNot Nothing Then id = Convert.ToString(reqId).Trim()

    If Not id.StartsWith("RMG-") Then
        Me.AuditWriter.WriteLine(2, "Not an RMG Desk task (" & id & "), not sent", "Custom Trace", "RMG Desk")
    Else
        ' Date Actioned is UK local time. It is sent without a time zone; RMG Desk converts it from GMT/BST.
        Dim eventAtLocal As String = Nothing
        Dim rawAt As Object = eventAt
        Dim localAt As System.DateTime = System.DateTime.MinValue
        If rawAt IsNot Nothing Then
            If TypeOf rawAt Is System.DateTime Then
                localAt = CType(rawAt, System.DateTime)
            Else
                System.DateTime.TryParse(Convert.ToString(rawAt), System.Globalization.CultureInfo.GetCultureInfo("en-GB"), System.Globalization.DateTimeStyles.None, localAt)
            End If
        End If
        If localAt > System.DateTime.MinValue Then
            eventAtLocal = localAt.ToString("yyyy-MM-dd'T'HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture)
        End If

        Dim payload As New System.Collections.Generic.Dictionary(Of String, Object)
        payload("reqId") = id
        payload("taskSeq") = Convert.ToString(taskSeq)
        payload("event") = Convert.ToString(eventName)
        payload("eventSeq") = Convert.ToString(eventSeq)
        payload("eventAt") = eventAtLocal
        payload("resource") = Convert.ToString(resource)
        payload("comments") = Convert.ToString(comments)
        Dim json As String = Newtonsoft.Json.JsonConvert.SerializeObject(payload)

        ' TLS 1.2 (3072) is required by AWS; older .NET defaults may not include it.
        System.Net.ServicePointManager.SecurityProtocol = System.Net.ServicePointManager.SecurityProtocol Or CType(3072, System.Net.SecurityProtocolType)

        Dim req As System.Net.HttpWebRequest = CType(System.Net.WebRequest.Create(rmgDeskUrl), System.Net.HttpWebRequest)
        req.Method = "POST"
        req.ContentType = "application/json; charset=utf-8"
        req.Headers.Add("Authorization", "Bearer " & rmgDeskToken)
        req.Timeout = 15000
        Dim bytes As Byte() = System.Text.Encoding.UTF8.GetBytes(json)
        req.ContentLength = bytes.Length
        Using stream As System.IO.Stream = req.GetRequestStream()
            stream.Write(bytes, 0, bytes.Length)
        End Using

        Try
            Using resp As System.Net.HttpWebResponse = CType(req.GetResponse(), System.Net.HttpWebResponse)
                Using reader As New System.IO.StreamReader(resp.GetResponseStream())
                    Me.AuditWriter.WriteLine(2, CInt(resp.StatusCode).ToString() & " " & reader.ReadToEnd(), "Custom Trace", "RMG Desk response")
                End Using
            End Using
        Catch wex As System.Net.WebException
            ' 4xx/5xx from RMG Desk: record why (404 = no matching RMG- request, 401 = wrong token, 400 = bad data).
            Dim detail As String = wex.Message
            If wex.Response IsNot Nothing Then
                Using errResp As System.Net.HttpWebResponse = CType(wex.Response, System.Net.HttpWebResponse)
                    Using reader As New System.IO.StreamReader(errResp.GetResponseStream())
                        detail = CInt(errResp.StatusCode).ToString() & " " & reader.ReadToEnd()
                    End Using
                End Using
            End If
            Me.AuditWriter.WriteLine(2, "RMG Desk did not accept the event: " & detail & " | sent: " & json, "Custom Trace", "RMG Desk error")
        End Try
    End If
Catch ex As System.Exception
    Me.AuditWriter.WriteException("Notify RMG Desk (event): unexpected exception", ex, GetType(Odyssey.Workflow.WorkflowCodeActionNode), "Execute")
End Try
