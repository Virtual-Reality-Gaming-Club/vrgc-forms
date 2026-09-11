import { NextResponse } from 'next/server';

const ALLOWED_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const ALLOWED_ISSUE_TYPES = ['Technical', 'Event', 'Membership', 'Account', 'Payment', 'Other'];

export async function POST(req: Request) {
  try {
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 65536) {
      return NextResponse.json(
        { success: false, error: 'Payload too large. Maximum size is 64KB.' },
        { status: 413 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { subject, description } = body;

    if (
      !subject ||
      !description ||
      typeof subject !== 'string' ||
      typeof description !== 'string'
    ) {
      return NextResponse.json(
        { success: false, error: 'Subject and description are required.' },
        { status: 400 }
      );
    }

    const cleanSubject = subject.trim();
    const cleanDescription = description.trim();

    if (!cleanSubject || !cleanDescription) {
      return NextResponse.json(
        { success: false, error: 'Subject and description cannot be empty.' },
        { status: 400 }
      );
    }

    if (cleanSubject.length < 2 || cleanSubject.length > 200) {
      return NextResponse.json(
        { success: false, error: 'Subject must be between 2 and 200 characters.' },
        { status: 400 }
      );
    }

    if (cleanDescription.length < 5 || cleanDescription.length > 3000) {
      return NextResponse.json(
        { success: false, error: 'Description must be between 5 and 3,000 characters.' },
        { status: 400 }
      );
    }

    const scriptUrl = process.env.GOOGLE_SCRIPT_REFERRAL_URL;
    if (!scriptUrl) {
      return NextResponse.json(
        { success: true, warning: 'Referral Google Script URL is not configured on server.' },
        { status: 200 }
      );
    }

    const rawPriority = typeof body.priority === 'string' ? body.priority.trim().toLowerCase() : '';
    const priority = ALLOWED_PRIORITIES.includes(rawPriority) ? rawPriority : 'low';

    const rawIssue = typeof body.issueType === 'string' ? body.issueType.trim() : '';
    const issueType = ALLOWED_ISSUE_TYPES.includes(rawIssue)
      ? rawIssue
      : (rawIssue ? rawIssue.slice(0, 50) : 'Technical');

    const formType = typeof body.formType === 'string' && body.formType.trim()
      ? body.formType.trim().slice(0, 30)
      : 'ticket';

    const fileName = typeof body.fileName === 'string' && body.fileName.trim()
      ? body.fileName.trim().slice(0, 100)
      : 'None';

    const payload = {
      formType,
      issueType,
      priority,
      subject: cleanSubject,
      description: cleanDescription,
      fileName,
    };

    try {
      await fetch(scriptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
      });
    } catch (fetchErr) {
      console.error('[Referral Sheets API] Google Script dispatch failed:', fetchErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Referral ticket submitted successfully to Google Sheets!',
    });
  } catch (err: any) {
    console.error('[Referral Sheets API] Internal error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to submit referral to Google Sheets' },
      { status: 500 }
    );
  }
}
