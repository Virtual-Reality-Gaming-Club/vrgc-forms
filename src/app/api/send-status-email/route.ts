import { NextResponse } from 'next/server';

/**
 * VRGC Status Update Email API Endpoint
 * 
 * This endpoint sends automated cyberpunk-styled emails to members and candidates
 * when their registration or dossier status is updated by administrators.
 * 
 * Setup Instructions:
 * 1. To enable live delivery, add `RESEND_API_KEY` to your environment variables (.env.local).
 * 2. Alternatively, developers can easily swap the Resend fetch call below with Nodemailer/SMTP.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { recipientEmail, recipientName, statusType, statusValue, regNo = 'N/A' } = body;

    // Validate inputs
    if (!recipientEmail || !recipientName || !statusType || !statusValue) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: recipientEmail, recipientName, statusType, statusValue' },
        { status: 400 }
      );
    }

    // Determine the subject line based on status update context
    let subject = `[VRGC] Portal Status Update`;
    let greetingHeader = 'STATUS CALIBRATION';
    let statusMessageHtml = '';
    let statusColor = '#a855f7'; // Purple default

    if (statusType === 'id_card') {
      subject = `[VRGC] Digital ID Card Registry: ${statusValue}`;
      if (statusValue === 'Approved') {
        greetingHeader = 'ACCESS GRANTED';
        statusColor = '#10b981'; // Emerald Green
        statusMessageHtml = `
          <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
            Excellent news! Your official **VRGC Digital ID Card** has been calibrated and approved by the Leadership Core.
          </p>
          <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
            Your cybernetic member dossier is now live in the official registry under registration number: 
            <strong style="color: #a855f7; font-family: monospace;">${regNo}</strong>.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://vrgc.club/card/${regNo}" style="background: linear-gradient(135deg, #a855f7 0%, #d946ef 100%); color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; display: inline-block; box-shadow: 0 0 15px rgba(168, 85, 247, 0.4);">
              View Digital ID Card
            </a>
          </div>
        `;
      } else {
        greetingHeader = 'DOSSIER UNDER REVIEW';
        statusMessageHtml = `
          <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
            Your Digital ID Card dossier has been reset to **Pending** status. 
          </p>
          <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
            The administration team is currently reviewing your registration parameters. No immediate action is required.
          </p>
        `;
      }
    } else if (statusType === 'referral') {
      subject = `[VRGC] Candidate Dossier Update: ${statusValue}`;
      
      switch (statusValue) {
        case 'Invited to Interview':
          greetingHeader = 'INTERVIEW PHASE ACTIVATED';
          statusColor = '#f59e0b'; // Amber
          statusMessageHtml = `
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              Congratulations! Your candidate dossier has successfully passed the initial vetting stage.
            </p>
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              You have been **invited for an official interview** with the VRGC Core Panel. 
              Our team will reach out shortly with scheduling links and channel access details.
            </p>
          `;
          break;
        case 'Admitted':
          greetingHeader = 'WELCOME TO THE CORE';
          statusColor = '#10b981'; // Emerald
          statusMessageHtml = `
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6; color: #10b981; font-weight: bold;">
              CONGRATULATIONS AGENT!
            </p>
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              You have been officially **Admitted** into the **Virtual Reality & Gaming Club (VRGC)**!
            </p>
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              Your onboarding protocol is initiating. Keep an eye on your inbox and official Discord server announcements for next steps.
            </p>
          `;
          break;
        case 'Rejected':
          greetingHeader = 'DOSSIER TERMINATED';
          statusColor = '#ef4444'; // Red
          statusMessageHtml = `
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              Thank you for your interest in joining the Virtual Reality & Gaming Club. 
            </p>
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              After a thorough review of the current batch specifications, your dossier has been **Rejected** for this recruitment cycle.
              Do not be discouraged; recruitment drives reopen each season. Keep building and playing!
            </p>
          `;
          break;
        case 'In Process':
          greetingHeader = 'PROCESSING DOSSIER';
          statusColor = '#3b82f6'; // Blue
          statusMessageHtml = `
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              Your referred candidate dossier status has been updated to **In Process**.
            </p>
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              The recruitment board is actively evaluating your application parameters against current team needs.
            </p>
          `;
          break;
        case 'Interview Taken':
          greetingHeader = 'EVALUATION IN PROGRESS';
          statusColor = '#a855f7'; // Purple
          statusMessageHtml = `
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              Your VRGC interview phase is complete! 
            </p>
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              Your status is now updated to **Interview Taken**. The panel is finalizing scoring evaluations.
            </p>
          `;
          break;
        default:
          statusMessageHtml = `
            <p style="margin-bottom: 20px; font-size: 15px; line-height: 1.6;">
              Your candidate dossier status has been updated to: <strong>${statusValue}</strong>.
            </p>
          `;
      }
    }

    // High-fidelity Cyberpunk HTML Email Template
    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>\${subject}</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #05010a; color: #e2e8f0; font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="max-width: 600px; margin: 40px auto; background-color: #0d0614; border: 1px solid #331f47; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(168, 85, 247, 0.15);">
            
            <!-- Cyberpunk Neon Header Bar -->
            <div style="background: linear-gradient(90deg, #120720 0%, #1c0e30 100%); padding: 25px; text-align: center; border-bottom: 2px solid \${statusColor};">
              <h2 style="margin: 0; color: #ffffff; font-family: 'Orbitron', monospace; font-size: 18px; letter-spacing: 3px; font-weight: 800; text-transform: uppercase;">
                🎮 VRGC COMMAND CENTER
              </h2>
            </div>
            
            <!-- Main Content Area -->
            <div style="padding: 40px 30px;">
              <!-- Mini HUD Header -->
              <span style="font-family: monospace; font-size: 11px; color: \${statusColor}; letter-spacing: 2px; font-weight: bold; display: block; text-transform: uppercase; margin-bottom: 5px;">
                // PROTOCOL: \${greetingHeader}
              </span>
              
              <h1 style="margin: 0 0 25px 0; color: #ffffff; font-size: 22px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.5px;">
                Hello, \${recipientName}
              </h1>
              
              \${statusMessageHtml}
              
              <!-- Divider line -->
              <hr style="border: 0; border-top: 1px solid #231633; margin: 30px 0;">
              
              <!-- System logs footer info -->
              <table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; color: #7e758a;">
                <tr>
                  <td style="padding: 4px 0;"><strong>REGISTRY ID:</strong></td>
                  <td style="padding: 4px 0; text-align: right; color: #c084fc;">\${regNo}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0;"><strong>UPDATED STATUS:</strong></td>
                  <td style="padding: 4px 0; text-align: right; color: \${statusColor}; font-weight: bold;">\${statusValue.toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0;"><strong>SYSTEM CLOCK:</strong></td>
                  <td style="padding: 4px 0; text-align: right;">\${new Date().toUTCString()}</td>
                </tr>
              </table>
            </div>

            <!-- Footer Section -->
            <div style="background-color: #07020b; padding: 20px; text-align: center; border-top: 1px solid #180c29; font-size: 11px; color: #645c70;">
              <p style="margin: 0 0 10px 0;">
                Designed and developed with ❤️ for Virtual Reality & Gaming Club.
              </p>
              <p style="margin: 0;">
                Official social handles: @vrgc_official • Discord: discord.gg/vrgc
              </p>
            </div>
          </div>
        </body>
      </html>
    `;

    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey) {
      // ── LIVE TRANSMISSION PROTOCOL: Dispatch via Resend REST API ──
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer \${resendApiKey}`
        },
        body: JSON.stringify({
          from: 'VRGC Portal <no-reply@vrgc.club>',
          to: [recipientEmail],
          subject: subject,
          html: htmlTemplate,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        console.error('Resend email API request failed:', errorData);
        throw new Error(errorData.message || 'Resend provider error');
      }

      const resData = await res.json();
      return NextResponse.json({
        success: true,
        mode: 'live',
        id: resData.id,
        message: 'Notification email dispatched successfully via Resend API 🎉'
      });

    } else {
      // ── DEVELOPMENT/MOCK MODE PROTOCOL ──
      // Fallback: Simulation mode so development is never blocked by lack of API credentials.
      console.log('========================================================================');
      console.log('⚡ [MOCK EMAIL DISPATCHED]');
      console.log(`To: \${recipientName} <\${recipientEmail}>`);
      console.log(`Subject: \${subject}`);
      console.log(`Status Type: \${statusType}`);
      console.log(`Status Value: \${statusValue}`);
      console.log(`Registry RegNo: \${regNo}`);
      console.log('------------------------------------------------------------------------');
      console.log('Please configure RESEND_API_KEY environment variable for live email delivery.');
      console.log('========================================================================');

      return NextResponse.json({
        success: true,
        mode: 'mock',
        message: 'Simulated email dispatch logged to server terminal console. Configure RESEND_API_KEY for live delivery.'
      });
    }

  } catch (error: any) {
    console.error('Error in send-status-email API route:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal server error processing notification email' },
      { status: 500 }
    );
  }
}
