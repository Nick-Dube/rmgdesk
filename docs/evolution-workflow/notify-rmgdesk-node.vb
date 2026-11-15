' ============================================================================================
' RMG Desk: "Notify RMG Desk" code action node for the MRI Evolution workflow
' "RMG Integration Completed Task Email" (on the task entity, when TA_STATUS changes).
'
' Sends ASSIGNED, COMPLETE and CANCELLED to RMG Desk, which updates the matching request (RMG-000123).
' Wiring: "Email Trace" -> this node -> "End Trace", and also the "No" branch of "Complete?" -> this node,
' so one copy of the code handles every status change. It only sends for RMG- tasks and never stops the
' workflow: problems are written to the workflow trace instead. Set "Error and continue" to True.
'
' Fill in the two values below (from the CDK outputs EvolutionWebhookUrl and EvolutionWebhookTokenArn).
' ============================================================================================
Dim rmgDeskUrl As String = "https://PASTE-API-ID.execute-api.eu-west-2.amazonaws.com/integrations/evolution/task-status"
Dim rmgDeskToken As String = "PASTE-TOKEN-HERE"

Try
    ' Only tasks raised by RMG Desk exist there; old VTX600: tasks are skipped.
    Dim reqId As String = ""
    If ResultofReqID IsNot Nothing Then reqId = ResultofReqID.Trim()
    ' RMG Desk acts on ASSIGNED, COMPLETE and CANCELLED. ACTIVE (just raised) and HISTORY (the 90-day clean-up)
    ' are not sent.
    Dim newStatus As String = Convert.ToString(NewEntity.TA_STATUS).Trim().ToUpper()
    If Not reqId.StartsWith("RMG-") Then
        Me.AuditWriter.WriteLine(2, "Not an RMG Desk task (" & reqId & "), not sent", "Custom Trace", "RMG Desk")
    ElseIf newStatus <> "ASSIGNED" AndAlso newStatus <> "COMPLETE" AndAlso newStatus <> "CANCELLED" Then
        Me.AuditWriter.WriteLine(2, "Status " & newStatus & " is not sent to RMG Desk", "Custom Trace", "RMG Desk")
    Else
        ' Evolution holds UK local times. They are sent without a time zone; RMG Desk converts them from GMT/BST.
        Dim iso As String = "yyyy-MM-dd'T'HH:mm:ss"
        Dim inv As System.Globalization.CultureInfo = System.Globalization.CultureInfo.InvariantCulture

        Dim completedAt As String = Nothing
        If NewEntity.TA_FINISH_DATE > System.DateTime.MinValue Then
            completedAt = NewEntity.TA_FINISH_DATE.ToString(iso, inv)
        End If
        Dim attendedAt As String = Nothing
        If NewEntity.SlaTaskPerformance IsNot Nothing AndAlso NewEntity.SlaTaskPerformance.TaskPerfAttendDate > System.DateTime.MinValue Then
            attendedAt = NewEntity.SlaTaskPerformance.TaskPerfAttendDate.ToString(iso, inv)
        End If

        Dim payload As New System.Collections.Generic.Dictionary(Of String, Object)
        payload("reqId") = reqId
        payload("taskId") = Convert.ToString(NewEntity.TA_TASK_ID)
        payload("taskSeq") = Convert.ToString(NewEntity.Id)
        payload("status") = newStatus
        payload("oldStatus") = OldEntity.TA_STATUS
        payload("statusAt") = System.DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", inv)
        payload("completedAt") = completedAt
        payload("attendedAt") = attendedAt
        payload("resource") = Resource
        payload("comments") = Comments
        payload("priority") = Convert.ToString(NewEntity.TA_PRIORITY)
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
            ' 4xx/5xx from RMG Desk: record the reason (e.g. 404 = no matching RMG- request, 401 = wrong token).
            Dim detail As String = wex.Message
            If wex.Response IsNot Nothing Then
                Using errResp As System.Net.HttpWebResponse = CType(wex.Response, System.Net.HttpWebResponse)
                    Using reader As New System.IO.StreamReader(errResp.GetResponseStream())
                        detail = CInt(errResp.StatusCode).ToString() & " " & reader.ReadToEnd()
                    End Using
                End Using
            End If
            Me.AuditWriter.WriteLine(2, "RMG Desk did not accept the update: " & detail & " | sent: " & json, "Custom Trace", "RMG Desk error")
        End Try
    End If
Catch ex As System.Exception
    Me.AuditWriter.WriteException("Notify RMG Desk: unexpected exception", ex, GetType(Odyssey.Workflow.WorkflowCodeActionNode), "Execute")
End Try
